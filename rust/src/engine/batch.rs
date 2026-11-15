// Mở rộng mẫu URL: http://x/img[001-003].jpg -> img001.jpg, img002.jpg, img003.jpg
// Hỗ trợ nhiều mẫu trong một URL, giữ số chữ số đệm và đếm ngược.

const LIMIT: usize = 5000;

pub fn expand(url: &str) -> Vec<String> {
    expand_inner(url, LIMIT)
}

fn expand_inner(url: &str, limit: usize) -> Vec<String> {
    let Some((open, close, a, b)) = find_pattern(url) else { return vec![url.to_string()] };
    let (Ok(start), Ok(end)) = (a.parse::<u64>(), b.parse::<u64>()) else { return vec![url.to_string()] };
    let width = a.len();
    let numbers: Box<dyn Iterator<Item = u64>> =
        if start <= end { Box::new(start..=end) } else { Box::new((end..=start).rev()) };
    let mut out = Vec::new();
    for i in numbers {
        if out.len() >= limit {
            break;
        }
        let next = format!("{}{:0width$}{}", &url[..open], i, &url[close + 1..]);
        out.extend(expand_inner(&next, limit - out.len()));
    }
    out
}

/// Vị trí `[` và `]` cùng hai số của mẫu `[a-b]` đầu tiên.
fn find_pattern(url: &str) -> Option<(usize, usize, &str, &str)> {
    let mut from = 0;
    while let Some(rel) = url[from..].find('[') {
        let open = from + rel;
        if let Some(close_rel) = url[open..].find(']') {
            let close = open + close_rel;
            if let Some((a, b)) = url[open + 1..close].split_once('-') {
                let digits = |s: &str| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit());
                if digits(a) && digits(b) {
                    return Some((open, close, a, b));
                }
            }
        }
        from = open + 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::expand;

    #[test]
    fn expands_with_padding() {
        assert_eq!(
            expand("http://x/img[001-003].jpg"),
            ["http://x/img001.jpg", "http://x/img002.jpg", "http://x/img003.jpg"]
        );
    }

    #[test]
    fn nested_reverse_and_plain() {
        assert_eq!(expand("http://x/[1-2]/[b-c]/[2-1]").len(), 2 * 2);
        assert_eq!(expand("http://x/[3-1].bin")[0], "http://x/3.bin");
        assert_eq!(expand("http://x/a[b]c"), ["http://x/a[b]c"]);
    }

    #[test]
    fn capped() {
        assert_eq!(expand("http://x/[0-99999]").len(), 5000);
    }
}
