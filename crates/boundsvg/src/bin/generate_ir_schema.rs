use std::io::{self, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let schemas = boundsvg::ir_schema::generate_ir_schemas()?;
    let stdout = io::stdout();
    let mut output = stdout.lock();
    serde_json::to_writer_pretty(
        &mut output,
        &serde_json::json!({
            "normalizationVersion": schemas.normalization_version,
            "outputIr": schemas.output_ir,
            "emitIrInput": schemas.emit_ir_input,
        }),
    )?;
    output.write_all(b"\n")?;
    Ok(())
}
