use std::{env, fs, path::Path};

fn main() {
    let manifest_dir = env::var_os("CARGO_MANIFEST_DIR")
        .map(std::path::PathBuf::from)
        .expect("Cargo manifest directory is unavailable");
    let out_dir = env::var_os("OUT_DIR")
        .map(std::path::PathBuf::from)
        .expect("Cargo OUT_DIR is unavailable");

    for file in ["Cargo.toml", "tauri.conf.json"] {
        copy_file(&manifest_dir, &out_dir, file);
    }
    for directory in ["capabilities", "frontend-dist", "icons", "resources"] {
        copy_tree(&manifest_dir.join(directory), &out_dir.join(directory));
        println!("cargo:rerun-if-changed={directory}");
    }

    env::set_current_dir(&out_dir).expect("Could not enter Cargo OUT_DIR");
    tauri_build::build();
}

fn copy_file(source_root: &Path, destination_root: &Path, relative: &str) {
    fs::create_dir_all(destination_root).expect("Could not create Cargo OUT_DIR");
    fs::copy(source_root.join(relative), destination_root.join(relative))
        .unwrap_or_else(|error| panic!("Could not copy {relative} into Cargo OUT_DIR: {error}"));
    println!("cargo:rerun-if-changed={relative}");
}

fn copy_tree(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).expect("Could not create packaged asset directory");
    for entry in fs::read_dir(source).expect("Could not read packaged asset directory") {
        let entry = entry.expect("Could not read packaged asset entry");
        let target = destination.join(entry.file_name());
        if entry.file_type().expect("Could not inspect packaged asset").is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).expect("Could not copy packaged asset");
        }
    }
}
