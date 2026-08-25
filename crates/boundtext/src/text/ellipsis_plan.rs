/// Maximum exact prefix layouts that one authoritative ellipsis projection
/// may require. The limit is checked before candidate materialization so a
/// rejected operation cannot leak partial output or diagnostics.
pub(crate) const MAX_ELLIPSIS_CANDIDATES: usize = 1_024;

/// Evaluate legal prefix candidates in descending logical order and return the
/// first exact fit. No monotonicity is assumed: a shorter failure cannot prune
/// any untested candidate.
pub(crate) fn select_longest_fitting<T>(
    candidates: impl DoubleEndedIterator<Item = usize>,
    mut probe: impl FnMut(usize) -> Option<T>,
    mut fits: impl FnMut(&T) -> bool,
) -> Option<(usize, T)> {
    for candidate_prefix in candidates.rev() {
        let candidate = probe(candidate_prefix)?;
        if fits(&candidate) {
            return Some((candidate_prefix, candidate));
        }
    }
    None
}

/// Fallible counterpart used when candidate layout depends on an external
/// geometry provider. Provider/resource failures abort the complete search;
/// they are never interpreted as a rejected prefix.
pub(crate) fn try_select_longest_fitting<T, E>(
    candidates: impl DoubleEndedIterator<Item = usize>,
    mut probe: impl FnMut(usize) -> Result<Option<T>, E>,
    mut fits: impl FnMut(&T) -> bool,
) -> Result<Option<(usize, T)>, E> {
    for candidate_prefix in candidates.rev() {
        let Some(candidate) = probe(candidate_prefix)? else {
            return Ok(None);
        };
        if fits(&candidate) {
            return Ok(Some((candidate_prefix, candidate)));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::select_longest_fitting;

    #[test]
    fn selects_the_longest_non_monotone_legal_prefix() {
        let candidates = [0, 1, 2, 3, 4, 5];
        let selected = select_longest_fitting(candidates.into_iter(), Some, |candidate| {
            matches!(candidate, 1 | 3 | 5)
        });

        assert_eq!(selected, Some((5, 5)));
    }

    #[test]
    fn does_not_treat_a_shorter_failure_as_a_pruning_boundary() {
        let candidates = [0, 1, 2, 3, 4, 5, 6];
        let mut visited = Vec::new();
        let selected = select_longest_fitting(
            candidates.into_iter(),
            |candidate| {
                visited.push(candidate);
                Some(candidate)
            },
            |candidate| *candidate == 4,
        );

        assert_eq!(selected, Some((4, 4)));
        assert_eq!(visited, [6, 5, 4]);
    }
}
