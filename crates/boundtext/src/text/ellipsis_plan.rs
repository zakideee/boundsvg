//! Exact longest-prefix selection for authoritative ellipsis projection.
//!
//! Candidate order is explicit because shaped advance is not monotone in the
//! retained source length.

/// Maximum exact prefix layouts that one authoritative ellipsis projection
/// may require. The limit is checked before candidate materialization so a
/// rejected operation cannot leak partial output or diagnostics.
pub(crate) const ELLIPSIS_CANDIDATES_MAX: usize = 1_024;

/// Select the longest fitting prefix while preserving shaping, provider, and
/// resource failures. Any failure aborts the complete search;
/// they are never interpreted as a rejected prefix.
///
/// # Errors
///
/// Returns the first error produced while materializing a candidate.
pub(crate) fn try_select_longest_fitting<T, E>(
    candidates: impl DoubleEndedIterator<Item = usize>,
    mut probe: impl FnMut(usize) -> Result<Option<T>, E>,
    mut is_candidate_fit: impl FnMut(&T) -> bool,
) -> Result<Option<(usize, T)>, E> {
    for candidate_prefix in candidates.rev() {
        let Some(candidate) = probe(candidate_prefix)? else {
            return Ok(None);
        };
        if is_candidate_fit(&candidate) {
            return Ok(Some((candidate_prefix, candidate)));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::try_select_longest_fitting;

    #[test]
    fn selects_the_longest_non_monotone_legal_prefix() {
        let candidates = [0, 1, 2, 3, 4, 5];
        let selected = try_select_longest_fitting(
            candidates.into_iter(),
            |value| Ok::<_, ()>(Some(value)),
            |candidate| matches!(candidate, 1 | 3 | 5),
        )
        .unwrap();

        assert_eq!(selected, Some((5, 5)));
    }

    #[test]
    fn does_not_treat_a_shorter_failure_as_a_pruning_boundary() {
        let candidates = [0, 1, 2, 3, 4, 5, 6];
        let mut visited = Vec::new();
        let selected = try_select_longest_fitting(
            candidates.into_iter(),
            |candidate| {
                visited.push(candidate);
                Ok::<_, ()>(Some(candidate))
            },
            |candidate| *candidate == 4,
        )
        .unwrap();

        assert_eq!(selected, Some((4, 4)));
        assert_eq!(visited, [6, 5, 4]);
    }
}
