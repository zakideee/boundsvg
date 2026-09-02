export type MeasurementTextLayoutOperation =
  | "layoutTextFlow"
  | "layoutTextFlowWithExclusions"
  | "measureTextBlock"
  | "shrinkwrapText"
  | "shrinkwrapFlow"
  | "measureIntrinsicInlineSize";

export type TextLayoutOperation = MeasurementTextLayoutOperation | "renderTextLayout";
