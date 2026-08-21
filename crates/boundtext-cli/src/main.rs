use std::io::{self, Read as IoRead};
use std::path::PathBuf;

use clap::Parser;

mod types;

use types::{CliInput, CliOutput, run_layout};

/// boundtext layout validation CLI.
///
/// Reads a JSON fixture (or array of fixtures) from stdin or a file,
/// runs boundtext layout, and outputs JSON results to stdout.
#[derive(Parser)]
#[command(name = "boundtext-cli", version)]
struct Cli {
    /// Input JSON file (reads from stdin if omitted)
    #[arg(short, long)]
    input: Option<PathBuf>,

    /// Font directory (TTF/OTF files are registered by filename stem as alias)
    #[arg(short, long)]
    fonts: PathBuf,

    /// Pretty-print JSON output
    #[arg(long, default_value_t = false)]
    pretty: bool,

    /// Run a single fixture by ID (filters from batch input)
    #[arg(long)]
    id: Option<String>,
}

fn main() {
    let cli = Cli::parse();

    // Read input JSON
    let json_str = if let Some(ref path) = cli.input {
        std::fs::read_to_string(path).unwrap_or_else(|e| {
            eprintln!("Error reading {}: {}", path.display(), e);
            std::process::exit(1);
        })
    } else {
        let mut buffer = String::new();
        io::stdin().read_to_string(&mut buffer).unwrap_or_else(|e| {
            eprintln!("Error reading stdin: {e}");
            std::process::exit(1);
        });
        buffer
    };

    // Load fonts from directory
    let font_registry = load_fonts(&cli.fonts);

    // Parse input — single fixture or array
    let inputs: Vec<CliInput> = if json_str.trim_start().starts_with('[') {
        serde_json::from_str(&json_str).unwrap_or_else(|e| {
            eprintln!("Error parsing JSON array: {e}");
            std::process::exit(1);
        })
    } else {
        let single: CliInput = serde_json::from_str(&json_str).unwrap_or_else(|e| {
            eprintln!("Error parsing JSON: {e}");
            std::process::exit(1);
        });
        vec![single]
    };

    // Filter by ID if specified
    let inputs: Vec<CliInput> = if let Some(ref filter_id) = cli.id {
        inputs.into_iter().filter(|i| i.id == *filter_id).collect()
    } else {
        inputs
    };

    if inputs.is_empty() {
        eprintln!("No fixtures to process");
        std::process::exit(1);
    }

    // Run layout for each fixture
    let outputs: Vec<CliOutput> = inputs
        .iter()
        .map(|input| run_layout(input, &font_registry))
        .collect();

    // Output
    let json = if cli.pretty {
        serde_json::to_string_pretty(&outputs)
    } else {
        serde_json::to_string(&outputs)
    };

    match json {
        Ok(s) => println!("{s}"),
        Err(e) => {
            eprintln!("Error serializing output: {e}");
            std::process::exit(1);
        }
    }
}

/// Load all TTF/OTF fonts from a directory.
/// Each font file is registered with its filename stem as the alias.
fn load_fonts(dir: &PathBuf) -> boundtext::font::FontRegistry {
    use boundtext::font::FontRegistry;

    let mut registry = FontRegistry::new();

    let entries = std::fs::read_dir(dir).unwrap_or_else(|e| {
        eprintln!("Error reading font directory {}: {}", dir.display(), e);
        std::process::exit(1);
    });

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if ext != "ttf" && ext != "otf" {
            continue;
        }

        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        if stem.is_empty() {
            continue;
        }

        // Derive weight and style from filename conventions
        let (alias, weight, style) = parse_font_filename(&stem);

        let data = match std::fs::read(&path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("Warning: could not read {}: {}", path.display(), e);
                continue;
            }
        };

        if let Err(e) = registry.register(data, alias.clone(), weight, style) {
            eprintln!(
                "Warning: could not register {} (alias={}): {}",
                path.display(),
                alias,
                e
            );
        } else {
            eprintln!("Loaded font: alias={alias}, weight={weight}");
        }
    }

    registry
}

/// Parse font filename to extract alias, weight, and style.
///
/// Conventions:
/// - `NotoSansJP-Regular.subset` → alias="NotoSansJP", weight=400, style=Normal
/// - `NotoSansJP-Bold` → alias="NotoSansJP", weight=700, style=Normal
/// - `NotoSansJP-Italic` → alias="NotoSansJP", weight=400, style=Italic
fn parse_font_filename(stem: &str) -> (String, u16, boundtext::font::FontStyle) {
    use boundtext::font::FontStyle;

    // Remove .subset suffix if present
    let stem = stem.strip_suffix(".subset").unwrap_or(stem);

    // Split by '-' to find weight/style suffix
    let parts: Vec<&str> = stem.rsplitn(2, '-').collect();
    if parts.len() == 2 {
        let suffix = parts[0].to_lowercase();
        let base = parts[1].to_string();

        let (weight, style) = match suffix.as_str() {
            "thin" => (100, FontStyle::Normal),
            "extralight" | "ultralight" => (200, FontStyle::Normal),
            "light" => (300, FontStyle::Normal),
            "medium" => (500, FontStyle::Normal),
            "semibold" | "demibold" => (600, FontStyle::Normal),
            "bold" => (700, FontStyle::Normal),
            "extrabold" | "ultrabold" => (800, FontStyle::Normal),
            "black" | "heavy" => (900, FontStyle::Normal),
            "italic" => (400, FontStyle::Italic),
            "bolditalic" => (700, FontStyle::Italic),
            _ => (400, FontStyle::Normal),
        };

        (base, weight, style)
    } else {
        (stem.to_string(), 400, FontStyle::Normal)
    }
}
