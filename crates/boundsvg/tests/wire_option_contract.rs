use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use quote::ToTokens;
use syn::visit::Visit;
use syn::{Attribute, Field, ItemEnum, ItemImpl, ItemMacro, ItemStruct, ItemType, Type};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

const OPTION_INVENTORY_GOLDEN: &str = include_str!("fixtures/wire-option-contract.golden.txt");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WorkspaceCoverage {
    EngineWire,
    Excluded,
}

#[derive(Clone, Copy, Debug)]
struct WorkspaceCratePolicy {
    package: &'static str,
    coverage: WorkspaceCoverage,
    reason: &'static str,
}

// Every Cargo workspace member must be classified here. An engine crate is
// scanned recursively; an exclusion needs a durable boundary reason. This is
// intentionally exact so adding, removing, or renaming a crate requires an
// explicit contract decision instead of silently changing coverage.
const WORKSPACE_CRATE_POLICIES: &[WorkspaceCratePolicy] = &[
    WorkspaceCratePolicy {
        package: "boundsvg",
        coverage: WorkspaceCoverage::EngineWire,
        reason: "owns the core WASM render boundary and output IR",
    },
    WorkspaceCratePolicy {
        package: "boundshape",
        coverage: WorkspaceCoverage::EngineWire,
        reason: "owns shape DTOs carried through the core WASM boundary",
    },
    WorkspaceCratePolicy {
        package: "boundtext",
        coverage: WorkspaceCoverage::EngineWire,
        reason: "owns text DTOs carried through the core WASM boundary",
    },
    WorkspaceCratePolicy {
        package: "boundtext-cli",
        coverage: WorkspaceCoverage::Excluded,
        reason: "CLI-only JSON I/O; it consumes boundtext but is not part of the core WASM schema",
    },
    WorkspaceCratePolicy {
        package: "boundmp4",
        coverage: WorkspaceCoverage::Excluded,
        reason: "independent MP4 muxer WASM schema with a separate package boundary",
    },
];

#[derive(Clone, Copy, Debug)]
struct SourceAllowance {
    source: &'static str,
    item: &'static str,
    reason: &'static str,
}

// Manual serialization is normally forbidden because source-AST field
// inventory cannot prove its omission policy. These exact projections have a
// separately tested structural contract that cannot be expressed by deriving.
const MANUAL_SERIALIZE_ALLOWLIST: &[SourceAllowance] = &[
    SourceAllowance {
        source: "crates/boundsvg/src/ir/types.rs",
        item: "Ir",
        reason: "canonical structural IR serialization excludes envelope-owned warnings while preserving every schema-generated field",
    },
    SourceAllowance {
        source: "crates/boundsvg/src/ir/types.rs",
        item: "LinesProjection",
        reason: "test-only projection exercises custom Line serialization without creating a bridge DTO",
    },
];

// Item macros can emit DTOs invisible to syn's unexpanded AST. These three
// invocations generate test counters or font backend helpers, never serde DTOs.
const ITEM_MACRO_ALLOWLIST: &[SourceAllowance] = &[
    SourceAllowance {
        source: "crates/boundshape/src/lib.rs",
        item: "thread_local@56b2357ad021f1a3",
        reason: "generates cfg(test) performance counters, not a wire DTO",
    },
    SourceAllowance {
        source: "crates/boundtext/src/phase_trace.rs",
        item: "thread_local@d84770b901b77b8f",
        reason: "generates hidden benchmark counters, not a wire DTO",
    },
    SourceAllowance {
        source: "crates/boundtext/src/font/backend_rustybuzz.rs",
        item: "self_cell@9abaf6da1176dbb1",
        reason: "generates a self-referential rustybuzz font holder, not a wire DTO",
    },
    SourceAllowance {
        source: "crates/boundtext/src/font/backend_ttfparser.rs",
        item: "self_cell@1766b3a991d52a96",
        reason: "generates a self-referential ttf-parser font holder, not a wire DTO",
    },
];

// Wire DTO fields must name their concrete Rust type. Aliases are intentionally
// unsupported: otherwise the source-AST inventory can no longer prove whether
// a field is Option and which omission policy applies.

// Only derives known not to emit additional items are accepted on type
// declarations in engine crates. A new derive is reviewable by extending this
// list; this prevents an opaque derive on a marker type from generating an
// unscanned sibling DTO.
const SAFE_TYPE_DERIVES: &[&str] = &[
    "Clone",
    "Copy",
    "Debug",
    "Default",
    "Deserialize",
    "Eq",
    "Error",
    "Hash",
    "JsonSchema",
    "Ord",
    "PartialEq",
    "PartialOrd",
    "Serialize",
];

// Built-in attributes and serde metadata do not generate sibling DTOs.
// Procedural attributes on any struct/enum require a source-specific allowance,
// because their expansion is otherwise invisible to this test.
const SAFE_TYPE_ATTRIBUTES: &[&str] = &[
    "allow",
    "cfg",
    "derive",
    "doc",
    "expect",
    "must_use",
    "non_exhaustive",
    "repr",
    "schemars",
    "serde",
];
const TYPE_ATTRIBUTE_ALLOWLIST: &[SourceAllowance] = &[
    SourceAllowance {
        source: "crates/boundsvg/src/lib.rs",
        item: "BoundSvgEngine#wasm_bindgen",
        reason: "exports the concrete engine wrapper to JS; its request/response DTOs remain explicit Rust types",
    },
    SourceAllowance {
        source: "crates/boundsvg/src/lib.rs",
        item: "BoundSvgPreparedScene#wasm_bindgen",
        reason: "exports the concrete prepared-scene wrapper to JS; it does not generate serde DTOs",
    },
    SourceAllowance {
        source: "crates/boundsvg/src/lib.rs",
        item: "BoundSvgRasterScene#wasm_bindgen",
        reason: "exports one opaque retained IR handle to JS; all serialized render DTOs remain explicit Rust types",
    },
];

const CANONICAL_TEXT_EFFECTS: &[(&str, &str)] = &[
    ("crates/boundtext/src/text/types.rs", "TextShadowLayer"),
    ("crates/boundtext/src/text/types.rs", "TextStrokeLayer"),
];

#[derive(Clone, Debug)]
struct WorkspaceCrate {
    package: String,
    source_root: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct OptionField {
    crate_name: String,
    source: String,
    owner: String,
    name: String,
    wire_name: String,
    policy: OptionSerialization,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum OptionSerialization {
    OmitNone,
    Skipped,
    Null,
}

impl OptionSerialization {
    const fn as_str(self) -> &'static str {
        match self {
            Self::OmitNone => "omit-none",
            Self::Skipped => "skipped",
            Self::Null => "null",
        }
    }
}

#[derive(Clone, Debug)]
struct EffectReference {
    source: String,
    owner: String,
    field: String,
    rust_type: String,
}

#[derive(Clone, Debug)]
struct StructShape {
    source: String,
    owner: String,
    wire_fields: BTreeSet<String>,
}

#[derive(Clone, Debug)]
struct TypeAlias {
    source: String,
    name: String,
}

#[derive(Clone, Debug)]
struct WireFieldType {
    source: String,
    owner: String,
    field: String,
    identifiers: BTreeSet<String>,
}

#[derive(Clone, Debug)]
struct SourceItem {
    source: String,
    name: String,
}

#[derive(Clone, Debug)]
struct ItemMacroUse {
    source: String,
    name: String,
    allowance_key: String,
}

#[derive(Clone, Debug)]
struct TypeAttribute {
    source: String,
    owner: String,
    name: String,
}

#[derive(Default)]
struct Inventory {
    crate_name: String,
    source: String,
    option_fields: Vec<OptionField>,
    effect_references: Vec<EffectReference>,
    struct_shapes: Vec<StructShape>,
    type_aliases: Vec<TypeAlias>,
    wire_field_types: Vec<WireFieldType>,
    manual_serialize_impls: Vec<SourceItem>,
    item_macros: Vec<ItemMacroUse>,
    type_attributes: Vec<TypeAttribute>,
}

fn derive_names(attributes: &[Attribute]) -> Vec<String> {
    let mut names = Vec::new();
    for attribute in attributes {
        if !attribute.path().is_ident("derive") {
            continue;
        }
        if let Ok(paths) = attribute.parse_args_with(
            syn::punctuated::Punctuated::<syn::Path, syn::Token![,]>::parse_terminated,
        ) {
            names.extend(paths.iter().filter_map(|path| {
                path.segments
                    .last()
                    .map(|segment| segment.ident.to_string())
            }));
        }
    }
    names
}

fn is_schema_cfg_attr(attribute: &Attribute) -> bool {
    if !attribute.path().is_ident("cfg_attr") {
        return false;
    }
    let compact = attribute
        .meta
        .to_token_stream()
        .to_string()
        .replace(' ', "");
    compact == "cfg_attr(feature=\"schema\",derive(schemars::JsonSchema))"
        || compact == "cfg_attr(feature=\"ir-schema\",derive(schemars::JsonSchema))"
        || (compact.starts_with("cfg_attr(feature=\"schema\",schemars(") && compact.ends_with("))"))
        || (compact.starts_with("cfg_attr(feature=\"ir-schema\",schemars(")
            && compact.ends_with("))"))
}

fn derives_serialize(attributes: &[Attribute]) -> bool {
    derive_names(attributes)
        .iter()
        .any(|derive| derive == "Serialize")
}

fn direct_option(rust_type: &Type) -> bool {
    matches!(rust_type, Type::Path(path) if path.path.segments.last().is_some_and(|segment| segment.ident == "Option"))
}

fn compact_attributes(attributes: &[Attribute]) -> String {
    attributes
        .iter()
        .filter(|attribute| attribute.path().is_ident("serde"))
        .map(|attribute| attribute.meta.to_token_stream().to_string())
        .collect::<String>()
        .replace(' ', "")
}

fn option_serialization(attributes: &[Attribute]) -> OptionSerialization {
    let serde = compact_attributes(attributes);
    if serde.contains("serde(skip)")
        || serde.contains("serde(skip,")
        || serde.contains(",skip)")
        || serde.contains("skip_serializing)")
        || serde.contains("skip_serializing,")
    {
        return OptionSerialization::Skipped;
    }
    if serde.contains("skip_serializing_if=\"Option::is_none\"") {
        return OptionSerialization::OmitNone;
    }
    OptionSerialization::Null
}

fn compact_type(rust_type: &Type) -> String {
    rust_type.to_token_stream().to_string().replace(' ', "")
}

fn serde_string_value(attributes: &[Attribute], key: &str) -> Option<String> {
    let serde = compact_attributes(attributes);
    let prefix = format!("{key}=\"");
    let start = serde.find(&prefix)? + prefix.len();
    let remainder = serde.get(start..)?;
    let end = remainder.find('"')?;
    remainder.get(..end).map(ToString::to_string)
}

fn camel_case(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut uppercase_next = false;
    for character in value.chars() {
        if character == '_' {
            uppercase_next = true;
        } else if uppercase_next {
            result.extend(character.to_uppercase());
            uppercase_next = false;
        } else {
            result.push(character);
        }
    }
    result
}

fn wire_field_name(field: &Field, rename_all: Option<&str>) -> String {
    if let Some(rename) = serde_string_value(&field.attrs, "rename") {
        return rename;
    }
    let rust_name = field
        .ident
        .as_ref()
        .map_or_else(|| "<tuple>".to_string(), ToString::to_string);
    if rename_all == Some("camelCase") {
        camel_case(&rust_name)
    } else {
        rust_name
    }
}

#[derive(Default)]
struct TypeIdentifierCollector {
    identifiers: BTreeSet<String>,
}

impl<'ast> Visit<'ast> for TypeIdentifierCollector {
    fn visit_path_segment(&mut self, node: &'ast syn::PathSegment) {
        self.identifiers.insert(node.ident.to_string());
        syn::visit::visit_path_segment(self, node);
    }
}

fn type_identifiers(rust_type: &Type) -> BTreeSet<String> {
    let mut collector = TypeIdentifierCollector::default();
    collector.visit_type(rust_type);
    collector.identifiers
}

fn outer_type_name(rust_type: &Type) -> String {
    match rust_type {
        Type::Path(path) => path.path.segments.last().map_or_else(
            || compact_type(rust_type),
            |segment| segment.ident.to_string(),
        ),
        _ => compact_type(rust_type),
    }
}

fn stable_token_fingerprint(tokens: &impl ToTokens) -> u64 {
    // FNV-1a is deliberately implemented here instead of using DefaultHasher,
    // whose output is not a stable file format. Comments/spacing are absent
    // from TokenStream, while every syntactic token affects the fingerprint.
    let compact = tokens.to_token_stream().to_string().replace(' ', "");
    compact
        .as_bytes()
        .iter()
        .fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
        })
}

impl Inventory {
    fn inspect_field(&mut self, owner: &str, field: &Field, rename_all: Option<&str>) {
        let name = field
            .ident
            .as_ref()
            .map_or_else(|| "<tuple>".to_string(), ToString::to_string);
        let wire_name = wire_field_name(field, rename_all);
        let rust_type = compact_type(&field.ty);
        if rust_type.contains("TextStrokeLayer") || rust_type.contains("TextShadowLayer") {
            self.effect_references.push(EffectReference {
                source: self.source.clone(),
                owner: owner.to_string(),
                field: name.clone(),
                rust_type,
            });
        }
        self.wire_field_types.push(WireFieldType {
            source: self.source.clone(),
            owner: owner.to_string(),
            field: name.clone(),
            identifiers: type_identifiers(&field.ty),
        });
        if direct_option(&field.ty) {
            self.option_fields.push(OptionField {
                crate_name: self.crate_name.clone(),
                source: self.source.clone(),
                owner: owner.to_string(),
                name,
                wire_name,
                policy: option_serialization(&field.attrs),
            });
        }
    }

    fn inspect_type_attributes(&mut self, owner: &str, attributes: &[Attribute]) {
        for derive in derive_names(attributes) {
            if !SAFE_TYPE_DERIVES.contains(&derive.as_str()) {
                self.type_attributes.push(TypeAttribute {
                    source: self.source.clone(),
                    owner: owner.to_string(),
                    name: format!("derive({derive})"),
                });
            }
        }
        for attribute in attributes {
            let attribute_name = attribute.path().segments.last().map_or_else(
                || "<unknown>".to_string(),
                |segment| segment.ident.to_string(),
            );
            if !SAFE_TYPE_ATTRIBUTES.contains(&attribute_name.as_str())
                && !is_schema_cfg_attr(attribute)
            {
                self.type_attributes.push(TypeAttribute {
                    source: self.source.clone(),
                    owner: owner.to_string(),
                    name: attribute_name,
                });
            }
        }
    }

    fn record_struct_shape(&mut self, node: &ItemStruct) {
        let rename_all = serde_string_value(&node.attrs, "rename_all");
        let wire_fields = node
            .fields
            .iter()
            .filter(|field| option_serialization(&field.attrs) != OptionSerialization::Skipped)
            .map(|field| wire_field_name(field, rename_all.as_deref()))
            .collect();
        self.struct_shapes.push(StructShape {
            source: self.source.clone(),
            owner: node.ident.to_string(),
            wire_fields,
        });
    }
}

impl<'ast> Visit<'ast> for Inventory {
    fn visit_item_struct(&mut self, node: &'ast ItemStruct) {
        self.record_struct_shape(node);
        let owner = node.ident.to_string();
        self.inspect_type_attributes(&owner, &node.attrs);
        if !derives_serialize(&node.attrs) {
            for field in &node.fields {
                let field_name = field
                    .ident
                    .as_ref()
                    .map_or_else(|| "<tuple>".to_string(), ToString::to_string);
                let rust_type = compact_type(&field.ty);
                if rust_type.contains("TextStrokeLayer") || rust_type.contains("TextShadowLayer") {
                    self.effect_references.push(EffectReference {
                        source: self.source.clone(),
                        owner: owner.clone(),
                        field: field_name,
                        rust_type,
                    });
                }
            }
            return;
        }
        let rename_all = serde_string_value(&node.attrs, "rename_all");
        for field in &node.fields {
            self.inspect_field(&owner, field, rename_all.as_deref());
        }
    }

    fn visit_item_enum(&mut self, node: &'ast ItemEnum) {
        self.inspect_type_attributes(&node.ident.to_string(), &node.attrs);
        if !derives_serialize(&node.attrs) {
            return;
        }
        let rename_all_fields = serde_string_value(&node.attrs, "rename_all_fields");
        for variant in &node.variants {
            let owner = format!("{}::{}", node.ident, variant.ident);
            let variant_rename_all = serde_string_value(&variant.attrs, "rename_all");
            let rename_all = variant_rename_all
                .as_deref()
                .or(rename_all_fields.as_deref());
            for field in &variant.fields {
                self.inspect_field(&owner, field, rename_all);
            }
        }
    }

    fn visit_item_type(&mut self, node: &'ast ItemType) {
        self.type_aliases.push(TypeAlias {
            source: self.source.clone(),
            name: node.ident.to_string(),
        });
    }

    fn visit_item_impl(&mut self, node: &'ast ItemImpl) {
        if node.trait_.as_ref().is_some_and(|(_, trait_path, _)| {
            trait_path
                .segments
                .last()
                .is_some_and(|segment| segment.ident == "Serialize")
        }) {
            self.manual_serialize_impls.push(SourceItem {
                source: self.source.clone(),
                name: outer_type_name(&node.self_ty),
            });
        }
        syn::visit::visit_item_impl(self, node);
    }

    fn visit_item_macro(&mut self, node: &'ast ItemMacro) {
        let name = node.mac.path.segments.last().map_or_else(
            || "<unknown>".to_string(),
            |segment| segment.ident.to_string(),
        );
        let allowance_key = format!(
            "{}@{:016x}",
            name,
            stable_token_fingerprint(&node.mac.tokens)
        );
        self.item_macros.push(ItemMacroUse {
            source: self.source.clone(),
            name,
            allowance_key,
        });
    }
}

fn rust_files(directory: &Path) -> TestResult<Vec<PathBuf>> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            paths.extend(rust_files(&path)?);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

fn workspace_crates(repo_root: &Path) -> TestResult<Vec<WorkspaceCrate>> {
    let output = Command::new("cargo")
        .args([
            "metadata",
            "--no-deps",
            "--format-version",
            "1",
            "--manifest-path",
        ])
        .arg(repo_root.join("Cargo.toml"))
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "cargo metadata failed while discovering workspace crates:\n{}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    let metadata: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    let workspace_members = metadata["workspace_members"]
        .as_array()
        .ok_or("cargo metadata omitted workspace_members")?;
    let packages = metadata["packages"]
        .as_array()
        .ok_or("cargo metadata omitted packages")?;
    let mut workspace_crates = Vec::new();
    for member in workspace_members {
        let member_id = member
            .as_str()
            .ok_or("cargo metadata workspace member was not a string")?;
        let package = packages
            .iter()
            .find(|package| package["id"].as_str() == Some(member_id))
            .ok_or_else(|| format!("cargo metadata omitted workspace package {member_id}"))?;
        let package_name = package["name"]
            .as_str()
            .ok_or("cargo metadata package omitted name")?;
        let manifest_path = package["manifest_path"]
            .as_str()
            .ok_or("cargo metadata package omitted manifest_path")?;
        let package_root = Path::new(manifest_path)
            .parent()
            .ok_or_else(|| format!("workspace package {package_name} has no package root"))?;
        workspace_crates.push(WorkspaceCrate {
            package: package_name.to_string(),
            source_root: package_root.join("src"),
        });
    }
    workspace_crates.sort_by(|left, right| left.package.cmp(&right.package));
    Ok(workspace_crates)
}

fn validate_workspace_classification(package_names: &[String]) -> Result<(), String> {
    let actual: BTreeSet<_> = package_names.iter().map(String::as_str).collect();
    let classified: BTreeSet<_> = WORKSPACE_CRATE_POLICIES
        .iter()
        .map(|policy| policy.package)
        .collect();
    let unclassified: Vec<_> = actual.difference(&classified).copied().collect();
    let stale: Vec<_> = classified.difference(&actual).copied().collect();
    if unclassified.is_empty() && stale.is_empty() {
        return Ok(());
    }
    Err(format!(
        "workspace wire coverage classification is stale.\nUnclassified crates: {}\nNo-longer-present classifications: {}\nAdd or remove an entry in WORKSPACE_CRATE_POLICIES. New engine crates must use EngineWire; exclusions require a durable schema-boundary reason.",
        if unclassified.is_empty() {
            "<none>".to_string()
        } else {
            unclassified.join(", ")
        },
        if stale.is_empty() {
            "<none>".to_string()
        } else {
            stale.join(", ")
        }
    ))
}

fn inventory() -> TestResult<Inventory> {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = crate_root
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| std::io::Error::other("boundsvg repository root not found"))?;
    let workspace_crates = workspace_crates(repo_root)?;
    let package_names: Vec<_> = workspace_crates
        .iter()
        .map(|workspace_crate| workspace_crate.package.clone())
        .collect();
    validate_workspace_classification(&package_names)?;

    let engine_packages: BTreeSet<_> = WORKSPACE_CRATE_POLICIES
        .iter()
        .filter(|policy| policy.coverage == WorkspaceCoverage::EngineWire)
        .map(|policy| policy.package)
        .collect();
    let mut combined = Inventory::default();
    for workspace_crate in workspace_crates
        .iter()
        .filter(|workspace_crate| engine_packages.contains(workspace_crate.package.as_str()))
    {
        for path in rust_files(&workspace_crate.source_root)? {
            let source = fs::read_to_string(&path)?;
            let syntax = syn::parse_file(&source)?;
            let mut file_inventory = Inventory {
                crate_name: workspace_crate.package.clone(),
                source: path.strip_prefix(repo_root)?.display().to_string(),
                ..Inventory::default()
            };
            file_inventory.visit_file(&syntax);
            combined.option_fields.extend(file_inventory.option_fields);
            combined
                .effect_references
                .extend(file_inventory.effect_references);
            combined.struct_shapes.extend(file_inventory.struct_shapes);
            combined.type_aliases.extend(file_inventory.type_aliases);
            combined
                .wire_field_types
                .extend(file_inventory.wire_field_types);
            combined
                .manual_serialize_impls
                .extend(file_inventory.manual_serialize_impls);
            combined.item_macros.extend(file_inventory.item_macros);
            combined
                .type_attributes
                .extend(file_inventory.type_attributes);
        }
    }
    Ok(combined)
}

fn allowance_matches(allowance: &SourceAllowance, source: &str, item: &str) -> bool {
    allowance.source == source && allowance.item == item
}

fn source_policy_violations(inventory: &Inventory) -> Vec<String> {
    let mut violations = Vec::new();
    let aliases_by_name: BTreeMap<_, Vec<_>> = inventory.type_aliases.iter().fold(
        BTreeMap::<&str, Vec<&TypeAlias>>::new(),
        |mut aliases, alias| {
            aliases.entry(&alias.name).or_default().push(alias);
            aliases
        },
    );
    for field in &inventory.wire_field_types {
        for alias_name in field
            .identifiers
            .iter()
            .filter(|identifier| aliases_by_name.contains_key(identifier.as_str()))
        {
            let definitions = aliases_by_name
                .get(alias_name.as_str())
                .into_iter()
                .flatten()
                .map(|alias| alias.source.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            violations.push(format!(
                "{}:{}.{} uses type alias {alias_name} (defined in {definitions}). Wire DTO aliases are prohibited; use the concrete type so Option fields and their omission policy remain visible.",
                field.source, field.owner, field.field
            ));
        }
    }
    for implementation in &inventory.manual_serialize_impls {
        if !MANUAL_SERIALIZE_ALLOWLIST.iter().any(|allowance| {
            allowance_matches(allowance, &implementation.source, &implementation.name)
        }) {
            violations.push(format!(
                "{}#{} manually implements Serialize. Derive Serialize so fields enter the AST inventory, or add the exact test-only/non-DTO implementation to MANUAL_SERIALIZE_ALLOWLIST with a reason.",
                implementation.source, implementation.name
            ));
        }
    }
    for item_macro in &inventory.item_macros {
        if !ITEM_MACRO_ALLOWLIST.iter().any(|allowance| {
            allowance_matches(allowance, &item_macro.source, &item_macro.allowance_key)
        }) {
            violations.push(format!(
                "{} invokes item macro {}! ({}), whose expanded DTOs are invisible to this source-AST guard. Define wire DTOs explicitly, or add this exact token fingerprint to ITEM_MACRO_ALLOWLIST with a proven-non-DTO reason.",
                item_macro.source, item_macro.name, item_macro.allowance_key
            ));
        }
    }
    for attribute in &inventory.type_attributes {
        let allowance_item = format!("{}#{}", attribute.owner, attribute.name);
        if !TYPE_ATTRIBUTE_ALLOWLIST
            .iter()
            .any(|allowance| allowance_matches(allowance, &attribute.source, &allowance_item))
        {
            violations.push(format!(
                "{}#{} uses unapproved type attribute {}. Prove it cannot emit a sibling DTO, then add this exact attribute to TYPE_ATTRIBUTE_ALLOWLIST with a reason.",
                attribute.source, attribute.owner, attribute.name
            ));
        }
    }
    violations.sort();
    violations.dedup();
    violations
}

fn stale_allowlist_entries(inventory: &Inventory) -> Vec<String> {
    let mut stale = Vec::new();
    for allowance in MANUAL_SERIALIZE_ALLOWLIST {
        if !inventory
            .manual_serialize_impls
            .iter()
            .any(|implementation| {
                allowance_matches(allowance, &implementation.source, &implementation.name)
            })
        {
            stale.push(format!(
                "manual Serialize allowance {}#{} is stale ({})",
                allowance.source, allowance.item, allowance.reason
            ));
        }
    }
    for allowance in ITEM_MACRO_ALLOWLIST {
        if !inventory.item_macros.iter().any(|item_macro| {
            allowance_matches(allowance, &item_macro.source, &item_macro.allowance_key)
        }) {
            stale.push(format!(
                "item macro allowance {}#{} is stale ({})",
                allowance.source, allowance.item, allowance.reason
            ));
        }
    }
    for allowance in TYPE_ATTRIBUTE_ALLOWLIST {
        if !inventory.type_attributes.iter().any(|attribute| {
            let item = format!("{}#{}", attribute.owner, attribute.name);
            allowance_matches(allowance, &attribute.source, &item)
        }) {
            stale.push(format!(
                "type attribute allowance {}#{} is stale ({})",
                allowance.source, allowance.item, allowance.reason
            ));
        }
    }
    stale
}

fn render_option_inventory(fields: &[OptionField]) -> Result<String, std::fmt::Error> {
    let mut fields = fields.to_vec();
    fields.sort();
    let mut rendered = String::from("# crate\tsource\towner\tfield\twire-field\tpolicy\n");
    for field in fields {
        writeln!(
            rendered,
            "{}\t{}\t{}\t{}\t{}\t{}",
            field.crate_name,
            field.source,
            field.owner,
            field.name,
            field.wire_name,
            field.policy.as_str()
        )?;
    }
    Ok(rendered)
}

fn effect_shape_violations(inventory: &Inventory) -> Vec<String> {
    let canonical_by_owner: BTreeMap<_, _> = CANONICAL_TEXT_EFFECTS
        .iter()
        .filter_map(|(source, owner)| {
            inventory
                .struct_shapes
                .iter()
                .find(|shape| shape.source == *source && shape.owner == *owner)
                .map(|shape| (*owner, shape))
        })
        .collect();
    let mut violations = Vec::new();
    for (source, owner) in CANONICAL_TEXT_EFFECTS {
        if !canonical_by_owner.contains_key(owner) {
            violations.push(format!(
                "canonical text effect {source}#{owner} is missing; update ownership deliberately before changing the guard"
            ));
        }
    }
    for (canonical_owner, canonical) in canonical_by_owner {
        for candidate in &inventory.struct_shapes {
            if candidate.wire_fields == canonical.wire_fields
                && (candidate.source != canonical.source || candidate.owner != canonical.owner)
            {
                violations.push(format!(
                    "{}#{} duplicates the wire field shape of {}#{}. Reuse the canonical boundtext type instead of adding a same-shape DTO.",
                    candidate.source,
                    candidate.owner,
                    canonical.source,
                    canonical_owner
                ));
            }
        }
    }
    violations.sort();
    violations.dedup();
    violations
}

fn fixture_inventory(source_name: &str, source: &str) -> TestResult<Inventory> {
    let syntax = syn::parse_file(source)?;
    let mut inventory = Inventory {
        crate_name: "fixture-engine".to_string(),
        source: source_name.to_string(),
        ..Inventory::default()
    };
    inventory.visit_file(&syntax);
    Ok(inventory)
}

#[test]
fn workspace_members_are_explicitly_classified() -> TestResult {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = crate_root
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| std::io::Error::other("boundsvg repository root not found"))?;
    let workspace_crates = workspace_crates(repo_root)?;
    let package_names: Vec<_> = workspace_crates
        .iter()
        .map(|workspace_crate| workspace_crate.package.clone())
        .collect();
    validate_workspace_classification(&package_names)?;
    assert!(
        WORKSPACE_CRATE_POLICIES
            .iter()
            .all(|policy| !policy.reason.is_empty()),
        "every workspace classification must explain its boundary"
    );
    Ok(())
}

#[test]
fn every_wire_option_matches_the_reviewed_golden_inventory() -> TestResult {
    let inventory = inventory()?;
    let violations: Vec<_> = inventory
        .option_fields
        .iter()
        .filter(|field| field.policy == OptionSerialization::Null)
        .map(|field| format!("{}:{}.{}", field.source, field.owner, field.name))
        .collect();
    assert!(
        violations.is_empty(),
        "Option::None must serialize as an absent property on every engine wire DTO:\n{}",
        violations.join("\n")
    );

    let actual = render_option_inventory(&inventory.option_fields)?;
    if std::env::var_os("BOUNDSVG_PRINT_WIRE_OPTION_INVENTORY").is_some() {
        println!("{actual}");
        return Ok(());
    }
    if actual != OPTION_INVENTORY_GOLDEN {
        return Err(format!(
            "wire Option inventory changed. Review every added/removed/policy-changed row, then update crates/boundsvg/tests/fixtures/wire-option-contract.golden.txt. To print the mechanically generated inventory, run:\nBOUNDSVG_PRINT_WIRE_OPTION_INVENTORY=1 cargo test -p boundsvg --test wire_option_contract every_wire_option_matches_the_reviewed_golden_inventory -- --nocapture\n\nActual inventory:\n{actual}"
        )
        .into());
    }
    Ok(())
}

#[test]
fn wire_dto_source_constructs_are_explicit_or_allowlisted() -> TestResult {
    let inventory = inventory()?;
    let violations = source_policy_violations(&inventory);
    assert!(violations.is_empty(), "{}", violations.join("\n"));
    let stale = stale_allowlist_entries(&inventory);
    assert!(
        stale.is_empty(),
        "remove obsolete wire guard allowances:\n{}",
        stale.join("\n")
    );
    Ok(())
}

#[test]
fn text_effect_wire_layers_have_one_structural_definition() -> TestResult {
    let inventory = inventory()?;
    let violations = effect_shape_violations(&inventory);
    assert!(violations.is_empty(), "{}", violations.join("\n"));
    assert!(!inventory.effect_references.is_empty());
    let stale_references: Vec<_> = inventory
        .effect_references
        .iter()
        .filter(|reference| reference.rust_type.contains("LayerInput"))
        .map(|reference| {
            format!(
                "{}:{}.{} ({})",
                reference.source, reference.owner, reference.field, reference.rust_type
            )
        })
        .collect();
    assert!(
        stale_references.is_empty(),
        "text effect carriers must use the canonical boundtext layer types:\n{}",
        stale_references.join("\n")
    );
    Ok(())
}

#[test]
fn rejects_option_hidden_behind_a_wire_field_type_alias() -> TestResult {
    let inventory = fixture_inventory(
        "fixtures/alias.rs",
        r"
            type MaybeColor = Option<String>;
            #[derive(Serialize)]
            struct AliasDto { color: MaybeColor }
        ",
    )?;
    let violations = source_policy_violations(&inventory);
    assert!(
        violations
            .iter()
            .any(|violation| violation.contains("type alias MaybeColor")),
        "alias bypass was not rejected: {violations:?}"
    );
    Ok(())
}

#[test]
fn rejects_manual_serialize_outside_the_narrow_allowlist() -> TestResult {
    let inventory = fixture_inventory(
        "fixtures/manual.rs",
        r"
            struct ManualDto { color: Option<String> }
            impl Serialize for ManualDto {}
        ",
    )?;
    let violations = source_policy_violations(&inventory);
    assert!(
        violations
            .iter()
            .any(|violation| violation.contains("manually implements Serialize")),
        "manual Serialize bypass was not rejected: {violations:?}"
    );
    Ok(())
}

#[test]
fn rejects_item_macro_generated_wire_dto() -> TestResult {
    let inventory = fixture_inventory(
        "fixtures/macro.rs",
        r"
            wire_dto! {
                struct GeneratedDto { color: Option<String> }
            }
        ",
    )?;
    let violations = source_policy_violations(&inventory);
    assert!(
        violations
            .iter()
            .any(|violation| violation.contains("item macro wire_dto!")),
        "item macro bypass was not rejected: {violations:?}"
    );
    Ok(())
}

#[test]
fn rejects_an_unclassified_workspace_crate() {
    let mut package_names: Vec<_> = WORKSPACE_CRATE_POLICIES
        .iter()
        .map(|policy| policy.package.to_string())
        .collect();
    package_names.push("boundfuture".to_string());
    let error = validate_workspace_classification(&package_names);
    assert!(
        error.is_err_and(|message| message.contains("boundfuture")),
        "new workspace crate bypass was not rejected"
    );
}

#[test]
fn rejects_a_same_shape_text_effect_under_another_name() -> TestResult {
    let mut inventory = fixture_inventory(
        "crates/boundtext/src/text/types.rs",
        r#"
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            struct TextStrokeLayer {
                color: String,
                width_px: f64,
                linejoin: Option<String>,
                linecap: Option<String>,
                dasharray: Option<String>,
                miterlimit: Option<f64>,
            }

            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            struct TextShadowLayer {
                dx: f64,
                dy: f64,
                blur_px: Option<f64>,
                color: String,
            }
        "#,
    )?;
    let duplicate = fixture_inventory(
        "crates/boundsvg/src/alternate_effect.rs",
        r#"
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            struct AlternateStrokeLayer {
                color: String,
                width_px: f64,
                linejoin: Option<String>,
                linecap: Option<String>,
                dasharray: Option<String>,
                miterlimit: Option<f64>,
            }
        "#,
    )?;
    inventory.struct_shapes.extend(duplicate.struct_shapes);
    let violations = effect_shape_violations(&inventory);
    assert!(
        violations
            .iter()
            .any(|violation| violation.contains("AlternateStrokeLayer")),
        "same-shape DTO bypass was not rejected: {violations:?}"
    );
    Ok(())
}

#[test]
fn canonical_text_effect_layers_round_trip_omitted_optional_fields() -> TestResult {
    use boundtext::text::types::{TextShadowLayer, TextStrokeLayer};

    let stroke = TextStrokeLayer {
        color: "#fff".to_string(),
        width_px: 2.0,
        linejoin: None,
        linecap: None,
        dasharray: None,
        miterlimit: None,
    };
    let shadow = TextShadowLayer {
        dx: 1.0,
        dy: 2.0,
        blur_px: None,
        color: "#0008".to_string(),
    };
    assert_eq!(
        serde_json::to_value(&stroke)?,
        serde_json::json!({ "color": "#fff", "widthPx": 2.0 })
    );
    assert_eq!(
        serde_json::to_value(&shadow)?,
        serde_json::json!({ "dx": 1.0, "dy": 2.0, "color": "#0008" })
    );
    assert_eq!(
        serde_json::from_value::<TextStrokeLayer>(serde_json::json!({
            "color": "#fff",
            "widthPx": 2.0
        }))?,
        stroke
    );
    assert_eq!(
        serde_json::from_value::<TextShadowLayer>(serde_json::json!({
            "dx": 1.0,
            "dy": 2.0,
            "color": "#0008"
        }))?,
        shadow
    );
    Ok(())
}
