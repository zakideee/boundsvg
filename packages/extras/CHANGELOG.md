# @boundsvg/extras

## 0.5.0

### Minor Changes

- [#26](https://github.com/zakideee/boundsvg/pull/26) [`836b0bd`](https://github.com/zakideee/boundsvg/commit/836b0bde282617138c09892c612f80ba7e710ff8) Thanks [@zakideee](https://github.com/zakideee)! - Replace the shared diagnostic shape with strict severity-specific fatal and
  recoverable contracts. Diagnostic constructors now take explicit options,
  recoverable warnings require `fallback` and `stage`, and malformed boundary
  values are rejected instead of being normalized through legacy adapters.

  Make operation envelopes the single warning authority across WASM, Core, and
  Worker routes. Structural IR no longer carries nested warnings, public IR
  retains detached `RecoverableError` values, Worker responses use one top-level
  warning list, and the WASM schema advances to version 29.

### Patch Changes

- Updated dependencies [[`836b0bd`](https://github.com/zakideee/boundsvg/commit/836b0bde282617138c09892c612f80ba7e710ff8), [`0e86217`](https://github.com/zakideee/boundsvg/commit/0e86217d6785232554c2d60fe4da45d751ffac4a), [`fee590a`](https://github.com/zakideee/boundsvg/commit/fee590ac43f2233e5732936d72982f21d7a45a81), [`671b9af`](https://github.com/zakideee/boundsvg/commit/671b9af0e53cdc7d210802b16607487f3334bbcd), [`75001ab`](https://github.com/zakideee/boundsvg/commit/75001ab74f4f0b383df4e2c1d9603636b0f4f297), [`a7a8815`](https://github.com/zakideee/boundsvg/commit/a7a8815e18484c99d2fa72f93c8f09480dc4a892), [`c33bc4d`](https://github.com/zakideee/boundsvg/commit/c33bc4dfafee20bc7d56218455f9a413dae13041), [`0571ebb`](https://github.com/zakideee/boundsvg/commit/0571ebb906091bc4e95fde8893368f151e918107), [`ba68136`](https://github.com/zakideee/boundsvg/commit/ba68136d824014abcf316dfedd8c44228a1d47ab)]:
  - @boundsvg/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`e04f34d`](https://github.com/zakideee/boundsvg/commit/e04f34d293d3653436589c651394ae8d79a5beef)]:
  - @boundsvg/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917), [`977e4dd`](https://github.com/zakideee/boundsvg/commit/977e4dd34a6d75223245e41edd9dbaff954d0917)]:
  - @boundsvg/core@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b), [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b), [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b)]:
  - @boundsvg/core@0.2.0

## 0.1.0

Initial public release.
