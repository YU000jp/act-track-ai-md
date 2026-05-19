use crate::types::{ClassificationRuleRecord, ClassificationRuleScope};

pub fn find_matching_rule(
    rules: &[ClassificationRuleRecord],
    process_name: &str,
    window_title: &str,
) -> Option<ClassificationRuleRecord> {
    let normalized_process = process_name.to_lowercase();
    let normalized_title = window_title.to_lowercase();

    rules
        .iter()
        .find(|rule| {
            if !rule.enabled {
                return false;
            }

            match rule.scope {
                ClassificationRuleScope::Process => {
                    !rule.process_name_pattern.is_empty()
                        && normalized_process.contains(&rule.process_name_pattern.to_lowercase())
                }
                ClassificationRuleScope::Title => {
                    // Window titles are intentionally matched by substring to absorb
                    // dynamic suffixes such as document names, tabs, and app state.
                    !rule.window_title_pattern.is_empty()
                        && normalized_title.contains(&rule.window_title_pattern.to_lowercase())
                }
                ClassificationRuleScope::Both => {
                    let process_matches = rule.process_name_pattern.is_empty()
                        || normalized_process.contains(&rule.process_name_pattern.to_lowercase());
                    let title_matches = rule.window_title_pattern.is_empty()
                        || normalized_title.contains(&rule.window_title_pattern.to_lowercase());
                    process_matches && title_matches
                }
            }
        })
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ActivityCategory;

    fn rule(scope: ClassificationRuleScope, process: &str, title: &str) -> ClassificationRuleRecord {
        ClassificationRuleRecord {
            id: 1,
            priority: 1,
            process_name_pattern: process.to_string(),
            window_title_pattern: title.to_string(),
            category: ActivityCategory::Productive,
            label: "Test".to_string(),
            enabled: true,
            scope,
            source: "manual".to_string(),
            hit_count: 0,
            last_used_at: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn title_scope_uses_substring_matching() {
        let matched = find_matching_rule(
            &[rule(ClassificationRuleScope::Title, "", "GitHub")],
            "Code",
            "GitHub - Pull Request #12",
        );

        assert!(matched.is_some());
    }

    #[test]
    fn both_scope_requires_both_fields_to_match() {
        let matched = find_matching_rule(
            &[rule(ClassificationRuleScope::Both, "code", "GitHub")],
            "Code",
            "GitHub - Pull Request #12",
        );

        assert!(matched.is_some());
    }

    #[test]
    fn blank_title_is_ignored_in_both_scope() {
        let matched = find_matching_rule(
            &[rule(ClassificationRuleScope::Both, "code", "")],
            "Code",
            "Any title",
        );

        assert!(matched.is_some());
    }
}
