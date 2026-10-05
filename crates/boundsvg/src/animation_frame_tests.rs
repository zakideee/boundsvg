//! Safe test-only Drop probes for owned sampled IR, paint scene and frame SVG temporaries.

use std::cell::RefCell;
use std::ops::Deref;
use std::sync::{Arc, Mutex, Weak};

use crate::animation_writer::StagedWriter;
use crate::raster_anim::{
    AnimatedRasterFormat, AnimatedRasterIterations, AnimationSession, AnimationSessionOptions,
};
use crate::{AnimatedRasterSession, BoundSvgEngine, BoundSvgRasterScene, RenderSvgOptions};

/// Serialize tests that observe the actual frame-local Drop scopes.
static PROBE_LOCK: Mutex<()> = Mutex::new(());
thread_local! { static PROBES: RefCell<Option<[Vec<Weak<()>>; 3]>> = const { RefCell::new(None) }; }

/// Own the original native value and drop it before its observable lifetime token.
pub(super) struct TrackedAllocation<T> {
    value: T,
    _lifetime: Option<Arc<()>>,
}

impl<T> Deref for TrackedAllocation<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.value
    }
}

/// Move a native temporary once; instrumentation exists only in native test builds.
pub(super) fn track_allocation<T>(value: T, index: usize) -> TrackedAllocation<T> {
    let lifetime = PROBES.with_borrow_mut(|probes| {
        probes.as_mut().map(|stages| {
            let token = Arc::new(());
            stages[index].push(Arc::downgrade(&token));
            token
        })
    });
    TrackedAllocation {
        value,
        _lifetime: lifetime,
    }
}

/// Keep the probe disabled after either success or an assertion failure.
struct ProbeScope;
impl ProbeScope {
    fn begin() -> Self {
        PROBES.with_borrow_mut(|probes| *probes = Some(std::array::from_fn(|_| Vec::new())));
        Self
    }
}
impl Drop for ProbeScope {
    fn drop(&mut self) {
        PROBES.with_borrow_mut(|probes| *probes = None);
    }
}

/// Assemble genuine native capabilities with a font-independent rectangle.
///
/// # Errors
///
/// Return fixture construction errors before arming any lifetime probes.
fn fixture(
    format: AnimatedRasterFormat,
) -> Result<(BoundSvgEngine, BoundSvgRasterScene, AnimatedRasterSession), String> {
    let engine = BoundSvgEngine::create();
    let ir = crate::parse_emit_ir(r##"{"width":8,"height":4,"root":{"type":"rect","nodeId":"allocation-probe-root","bbox":{"x":0,"y":0,"w":8,"h":4},"fill":"#e32"}}"##).map_err(|_| "Invalid owned rectangle fixture".to_string())?;
    let scene = BoundSvgRasterScene {
        ir,
        options: RenderSvgOptions::default(),
        owner: engine.owner.clone(),
        resolved: true,
    };
    let session = AnimatedRasterSession {
        format,
        owner: engine.owner.clone(),
        render_options: Some(RenderSvgOptions {
            animation: Some(crate::AnimationRenderModeInput::Static),
            ..RenderSvgOptions::default()
        }),
        session: AnimationSession::open(
            format,
            AnimationSessionOptions {
                frame_count: 1,
                iterations: AnimatedRasterIterations::Finite(1),
                raster_options: crate::rasterize::RasterizeOptions::default(),
            },
            vec![],
            vec![],
            StagedWriter::default(),
        )
        .map_err(|error| error.to_string())?,
    };
    Ok((engine, scene, session))
}

#[test]
fn actual_native_frame_drops_sample_paint_and_svg_before_drain() {
    let _lock = PROBE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for format in [AnimatedRasterFormat::Webp, AnimatedRasterFormat::Gif] {
        let (engine, mut scene, mut session) = fixture(format).expect("valid native fixture");
        let owner_count = std::sync::Arc::strong_count(&engine.owner);
        let _scope = ProbeScope::begin();
        engine
            .push_animation_frame(&mut session, &scene, 0.0, 20)
            .expect("successful native frame");
        PROBES.with_borrow(|probes| {
            for (index, observations) in probes.as_ref().expect("armed probe").iter().enumerate() {
                assert_eq!(observations.len(), 1, "one owned temporary per stage");
                assert!(
                    observations[0].upgrade().is_none(),
                    "stage {index} retains its original native value after push"
                );
            }
        });
        assert_eq!(std::sync::Arc::strong_count(&engine.owner), owner_count);
        scene.resolved = false;
        assert!(
            session
                .session
                .read_chunk()
                .expect("drain after borrow release")
                .is_some()
        );
        session.session.abort().expect("valid abort");
    }
}

#[test]
fn pending_and_count_reject_before_native_emitter_allocation() {
    let _lock = PROBE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for should_drain in [false, true] {
        let (engine, scene, mut session) =
            fixture(AnimatedRasterFormat::Gif).expect("valid native fixture");
        engine
            .push_animation_frame(&mut session, &scene, 0.0, 20)
            .expect("first frame");
        if should_drain {
            while session.session.read_chunk().expect("drain").is_some() {}
        }
        let _scope = ProbeScope::begin();
        let error = engine
            .push_animation_frame(&mut session, &scene, 0.0, 20)
            .expect_err("pending or excess frame");
        let crate::error::EngineError::StructuredContext { context, .. } = error else {
            panic!("structured state error");
        };
        assert_eq!(
            context["reason"],
            if should_drain {
                "excessFrames"
            } else {
                "pendingOutput"
            }
        );
        PROBES.with_borrow(|probes| {
            for observations in probes.as_ref().expect("armed probe") {
                assert!(observations.is_empty());
            }
        });
        session.session.abort().expect("valid abort");
    }
}
