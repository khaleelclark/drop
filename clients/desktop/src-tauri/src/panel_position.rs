// Physical screen coordinates keep the panel within the icon's current display.
pub const WIDTH: f64 = 400.0;
pub const HEIGHT: f64 = 520.0;

pub fn layout(
    icon: (f64, f64, f64, f64),
    area: (i32, i32, u32, u32),
    scale: f64,
) -> (i32, i32, u32, u32) {
    let (left, top, width, height) = area;
    let margin = (8.0 * scale).round() as i32;
    let w = (WIDTH * scale)
        .round()
        .min(width.saturating_sub((margin * 2) as u32) as f64)
        .max(1.0) as u32;
    let h = (HEIGHT * scale)
        .round()
        .min(height.saturating_sub((margin * 2) as u32) as f64)
        .max(1.0) as u32;
    let x = (icon.0 + icon.2 / 2.0 - w as f64 / 2.0).round() as i32;
    let y = (icon.1 + icon.3 + 4.0 * scale).round() as i32;
    (
        x.clamp(
            left + margin,
            (left + width as i32 - margin - w as i32).max(left + margin),
        ),
        y.clamp(
            top + margin,
            (top + height as i32 - margin - h as i32).max(top + margin),
        ),
        w,
        h,
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn panel_stays_inside_displays_at_edges_and_retina_scales() {
        for scale in [1.0, 1.5, 2.0] {
            for area in [
                (0, 24, 1440, 876),
                (-1920, 40, 1920, 1040),
                (1440, -900, 800, 600),
            ] {
                for icon_x in [area.0 as f64, (area.0 + area.2 as i32) as f64] {
                    let (x, y, w, h) =
                        layout((icon_x, area.1 as f64 - 24.0, 24.0, 24.0), area, scale);
                    assert!(x >= area.0 && y >= area.1);
                    assert!(x + w as i32 <= area.0 + area.2 as i32);
                    assert!(y + h as i32 <= area.1 + area.3 as i32);
                }
            }
        }
    }
    #[test]
    fn composer_size_is_fixed_when_the_work_area_fits() {
        for scale in [1.0, 2.0] {
            let (_, _, w, h) = layout((600.0, 0.0, 24.0, 24.0), (0, 24, 3000, 2000), scale);
            assert_eq!((w, h), ((WIDTH * scale) as u32, (HEIGHT * scale) as u32));
        }
    }
}
