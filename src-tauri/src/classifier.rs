use crate::settings::ClassificationRule;

pub fn find_matching_rule(
    rules: &[ClassificationRule],
    process_name: &str,
    window_title: &str,
) -> Option<ClassificationRule> {
    let normalized_process = process_name.to_lowercase();
    let normalized_title = window_title.to_lowercase();

    rules.iter().find(|rule| {
        let process_matches = rule
            .process_name_pattern
            .is_empty()
            || normalized_process.contains(&rule.process_name_pattern.to_lowercase());
        let title_matches = rule
            .window_title_pattern
            .is_empty()
            || normalized_title.contains(&rule.window_title_pattern.to_lowercase());
        process_matches && title_matches
    }).cloned()
}
