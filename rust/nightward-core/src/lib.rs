use wasm_bindgen::prelude::*;

/// Boundary smoke test: scalar across the JS<->wasm boundary.
#[wasm_bindgen]
pub fn ping() -> u32 {
    42
}

/// The pattern R1 scales up: state lives inside the module; JS reads it
/// through a zero-copy view into linear memory (ptr + len, no copying).
#[wasm_bindgen]
pub struct Spike {
    buf: Vec<u8>,
    w: u32,
    h: u32,
}

#[wasm_bindgen]
impl Spike {
    #[wasm_bindgen(constructor)]
    pub fn new(w: u32, h: u32) -> Spike {
        let mut buf = vec![0u8; (w * h) as usize];
        for y in 0..h {
            for x in 0..w {
                buf[(y * w + x) as usize] = if (x / 8 + y / 8) % 2 == 0 { 255 } else { 0 };
            }
        }
        Spike { buf, w, h }
    }
    pub fn ptr(&self) -> *const u8 { self.buf.as_ptr() }
    pub fn len(&self) -> u32 { self.buf.len() as u32 }
    pub fn width(&self) -> u32 { self.w }
    pub fn height(&self) -> u32 { self.h }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_is_42() { assert_eq!(ping(), 42); }

    #[test]
    fn checker_pattern() {
        let s = Spike::new(16, 16);
        assert_eq!(s.len(), 256);
        assert_eq!(s.buf[0], 255);   // first cell of first 8x8 block
        assert_eq!(s.buf[8], 0);     // first cell of second block
    }
}
