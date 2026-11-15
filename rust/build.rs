// Nhúng resources/icon.ico vào cả hai exe (icon trong Explorer, taskbar, Task Manager) bằng windres
// cạnh gcc của MSYS2. Không có windres thì vẫn build được, chỉ thiếu icon.
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let ico = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../resources/icon.ico");
    println!("cargo:rerun-if-changed={}", ico.display());
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("gnu") {
        return;
    }
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let (rc, obj) = (out.join("icon.rc"), out.join("icon.o"));
    // Chuỗi trong .rc coi "\" là ký tự thoát nên đổi sang "/"
    std::fs::write(&rc, format!("1 ICON \"{}\"\n", ico.display().to_string().replace('\\', "/"))).unwrap();
    let windres = std::env::var_os("RUSTC_LINKER")
        .map(|l| PathBuf::from(l).with_file_name("windres.exe"))
        .filter(|p| p.is_file())
        .unwrap_or_else(|| "windres".into());
    match Command::new(&windres).arg("-O").arg("coff").arg("-o").arg(&obj).arg(&rc).status() {
        // Truyền thẳng file .o cho linker: để trong thư viện tĩnh thì ld bỏ qua vì không ai gọi tới
        Ok(s) if s.success() => println!("cargo:rustc-link-arg-bins={}", obj.display()),
        r => println!("cargo:warning=Không nhúng được icon ({}): {r:?}", windres.display()),
    }
}
