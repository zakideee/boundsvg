import { Box, type BoxPosition, Canvas, Inline, Text } from "../../dist/index.js";

const position: BoxPosition = { x: 0.3, y: 0.5 };
<Canvas width={200} height={200}>
  <Text font="F" fontSizePx={12} transformOrigin={position} transform={{ rotateDeg: 90 }}>
    Text
  </Text>
</Canvas>;
<Box transformOrigin="center" />;
// @ts-expect-error Inline does not own a static transform origin.
<Inline transformOrigin="center">Inline</Inline>;
// @ts-expect-error Position ratios cannot use string axes.
<Box transformOrigin={{ x: "left", y: 0.5 }} />;
