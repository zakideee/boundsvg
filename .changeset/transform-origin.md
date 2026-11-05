---
"@boundsvg/core": minor
"@boundsvg/react": minor
---

Add box-relative `transformOrigin` keywords and two-axis ratios for static node transforms, including content-sized Text. Pixel origins remain supported separately; mixing origin forms is rejected. Node and text-unit animation keep their existing pivot and replacement behavior.

**Output-affecting:** Setting `transformOrigin` moves the pivot for static rotation and scale to the selected point of the completed layout box. Omitting it preserves existing output.
