You are a Senior AI/Backend Engineer working inside an existing repository.

Goal:
Implement and test a deterministic vector-layout DSL prototype for scientific diagrams. This system will let an LLM output a semantic JSON layout, while the backend compiles that layout into exact SVG/PNG. The styled image may later be passed into FLUX image-to-image, but geometry, arrows, labels, equations, and scientific meaning must remain deterministic.

Core principle:
The LLM must NOT generate raw SVG, raw path strings, Bézier control points, or arrays of X/Y points. The LLM may only emit high-level semantic components. The backend owns all geometry, layout, validation, rendering, and fallbacks.

Critical repo rule:
Before creating files or directories, inspect the repository structure. Reuse existing modules, clients, test folders, dependency files, config patterns, and naming conventions. Do not create duplicate folders or parallel architectures.

Do not commit anything. Implement locally and report the diff, test commands, and results.

────────────────────────────────
PHASE 0 — Repository inspection
────────────────────────────────

1. Inspect the project structure.
2. Identify:
   - Backend language/framework.
   - Existing AI/LLM pipeline code.
   - Existing FLUX/image generation client code, if any.
   - Existing test framework.
   - Existing dependency files.
   - Existing image/SVG/PDF/rendering utilities, if any.
3. Do not modify files yet.
4. Briefly summarize the intended integration points.

────────────────────────────────
PHASE 1 — Isolated Vector DSL prototype
────────────────────────────────

Create an isolated test/prototype file in the appropriate existing test or sandbox location.

Preferred filename:
- test_vector_dsl.py

But if the repo has a specific tests/sandbox convention, follow that convention.

Implement a class:

    VectorRenderer

The renderer should accept a validated Python dict or JSON-compatible layout object and return a raw SVG string.

Required top-level DSL shape:

    {
      "type": "vector_layout",
      "schema_version": "0.1",
      "canvas": {
        "width": 1024,
        "height": 768,
        "background": "white"
      },
      "components": [...]
    }

Do not allow arbitrary SVG passthrough.

Implement strict validation. Use the project’s existing validation style if available. Otherwise use Pydantic if already present; if not present, use lightweight manual validation first and avoid adding heavy dependencies unless necessary.

Supported V1 components:

1. axis

    {
      "id": "axes1",
      "type": "axis",
      "origin": "center",
      "x_label": "x",
      "y_label": "y",
      "show_grid": true
    }

Behavior:
- Render X/Y axes as deterministic black SVG lines.
- stroke-width: 4.
- Optional light grid.
- Arrowheads at positive axis directions.
- Labels rendered by backend, not FLUX.

2. curve

    {
      "id": "curve1",
      "type": "curve",
      "shape": "parabola",
      "coordinate_system": "axes1",
      "domain": [-3, 3],
      "parameters": {
        "a": 1,
        "h": 0,
        "k": 0
      },
      "label": "y = x^2"
    }

Supported curve shapes:
- line
- parabola
- exponential

Important:
- The LLM must not provide raw point arrays.
- The renderer may internally sample deterministic points to create an SVG path.
- The renderer owns coordinate transform, scaling, and path generation.
- Unknown shapes must raise a validation error.

3. label / math_label

    {
      "id": "label1",
      "type": "math_label",
      "text": "F = ma",
      "attach_to": "body1.center",
      "placement": "above"
    }

Behavior:
- Render deterministic SVG text.
- Support placement: above, below, left, right, center.
- For now, plain SVG text is acceptable.
- Leave a clean abstraction so KaTeX/MathJax/text-to-path can be added later.

4. vector

    {
      "id": "weight1",
      "type": "vector",
      "kind": "force",
      "target": "block1.center",
      "direction": "down",
      "label": "mg",
      "length": "medium"
    }

Supported directions:
- up
- down
- left
- right
- parallel_to
- perpendicular_to

For relation directions, support this shape:

    {
      "parallel_to": "surface1",
      "sense": "up_slope"
    }

    {
      "perpendicular_to": "surface1",
      "side": "outward"
    }

Behavior:
- Render arrows deterministically.
- The renderer computes arrow endpoints.
- Labels are deterministic SVG text.
- Supported vector kinds:
  - force
  - velocity
  - acceleration
  - electric_field
  - magnetic_field

5. body

    {
      "id": "block1",
      "type": "body",
      "shape": "block",
      "label": "m",
      "on": "incline1",
      "size": "medium"
    }

Supported body shapes:
- block
- sphere
- particle
- rod

Behavior:
- Render clean black outline shapes.
- If "on" references a surface, place the body on that surface using backend layout rules.
- Expose anchors:
  - center
  - top
  - bottom
  - left
  - right

6. surface

    {
      "id": "incline1",
      "type": "surface",
      "shape": "incline",
      "angle_deg": 30,
      "label": "θ"
    }

Supported surface shapes:
- floor
- wall
- incline

Behavior:
- Render deterministic surfaces.
- For incline, compute:
  - tangent direction
  - normal direction
  - up_slope
  - down_slope
- Expose anchors and geometry so vectors can attach to it.

7. angle_arc

    {
      "id": "theta1",
      "type": "angle_arc",
      "between": ["incline1", "horizontal"],
      "label": "θ"
    }

Behavior:
- Render a deterministic arc and label.
- Support at least incline-vs-horizontal.

8. dimension_line

    {
      "id": "height1",
      "type": "dimension_line",
      "from": "pointA",
      "to": "pointB",
      "label": "h"
    }

Behavior:
- Render line with arrowheads or ticks.
- Label deterministically.

9. connector

    {
      "id": "spring1",
      "type": "connector",
      "kind": "spring",
      "from": "wall1.right",
      "to": "block1.left",
      "label": "k"
    }

Supported connector kinds:
- rope
- spring
- rod

Behavior:
- Render deterministic connector geometry.
- Spring can be approximated with a zigzag path generated by backend.

10. trajectory

    {
      "id": "traj1",
      "type": "trajectory",
      "shape": "projectile",
      "from": "ball1.center",
      "direction": "up_right",
      "label": "trajectory"
    }

Supported trajectory shapes:
- projectile
- circular
- straight
- dashed_path

Behavior:
- Render dashed paths.
- Add optional motion arrowheads.

────────────────────────────────
PHASE 2 — Test fixtures
────────────────────────────────

In the same isolated test/prototype file, create at least three hardcoded layouts:

A. Math graph:
- axes
- grid
- parabola
- label "y = x²"

B. Free-body diagram:
- incline at 30 degrees
- block on incline
- weight vector mg downward
- normal vector N perpendicular to incline
- friction vector f parallel to incline upward
- angle arc θ

C. Spring/block system:
- wall
- floor
- block
- spring connector
- vector showing displacement x
- label k

For each layout:
1. Render SVG.
2. Assert the SVG:
   - starts with <svg
   - has a white background
   - contains deterministic paths/lines
   - does not contain raw unsafe external references
   - contains expected labels
3. Write output SVG files to a temporary or test-artifacts folder only if the repo convention allows it.
4. Do not write generated artifacts into source folders unless the repo already has a pattern for this.

Add negative tests:
- Unknown component type should fail.
- Unknown curve shape should fail.
- Raw SVG passthrough should fail.
- Component referencing a missing anchor should fail.
- Point arrays from model input should fail.

────────────────────────────────
PHASE 3 — SVG to PNG conversion
────────────────────────────────

Add a function:

    svg_to_png_bytes(svg: str) -> bytes

Rules:
1. First inspect existing dependencies/utilities.
2. If cairosvg is already present, use it.
3. If no SVG converter exists, add cairosvg only if appropriate for this repo.
4. If dependency changes are required, update the correct dependency file.
5. Keep the converter isolated and easy to replace.

Test:
- Convert each generated SVG to PNG bytes.
- Assert PNG bytes are non-empty.
- Assert PNG starts with the PNG signature.

────────────────────────────────
PHASE 4 — Optional FLUX integration test
────────────────────────────────

Do not invent a FLUX API client if one already exists.

1. Inspect the repo for existing FLUX/image generation code.
2. If an existing client exists, add an optional integration function in the test/prototype file that sends the clean PNG as an image-to-image / structure-preserving input.
3. Use the existing provider, endpoint, auth pattern, and environment variable names.
4. If no FLUX client exists, create only a small adapter interface/stub in the prototype file. Do not add a full production client yet.
5. The real FLUX integration test must be skipped unless credentials are available.

Prompt for FLUX styling:

    Educational whiteboard illustration, clean black pencil sketch, preserve exact geometry, preserve all arrows, preserve all labels, no extra objects, no distorted text.

Important:
- FLUX is optional styling only.
- The deterministic SVG/PNG is the fallback and source of truth.
- If FLUX fails, return/report the clean deterministic PNG/SVG.

Test behavior:
- If credentials exist, call the existing FLUX client and assert a successful response.
- If credentials are missing, skip gracefully and print a clear message.
- Do not fail the unit test suite because of missing external API credentials.

────────────────────────────────
PHASE 5 — Prepare, but do not integrate into production yet
────────────────────────────────

Do not modify the main production pipeline yet unless explicitly necessary for the isolated prototype to run.

However, prepare a short integration plan in your final report:

Target future file suggestion:
- backend/ai_engine/vector_pipeline.py
or the closest existing equivalent discovered in the repo.

Future production pipeline:

    LLM semantic planner
      -> vector_layout JSON
      -> strict schema validation
      -> physics/layout normalization
      -> deterministic SVG renderer
      -> clean PNG structure image
      -> optional FLUX styling
      -> deterministic overlay of labels/formulas/arrows
      -> frontend response

Also propose how the Llama system prompt should change:
- It may emit only vector_layout JSON.
- It must use semantic components.
- It must not emit raw SVG, path data, Bézier control points, or arrays of points.
- It must prefer anchors and relations over coordinates.
- It must describe physics relationships, not pixel positions.

────────────────────────────────
Implementation quality requirements
────────────────────────────────

1. Keep code small and readable.
2. Prefer deterministic output.
3. Use type hints.
4. Use dataclasses or Pydantic models if consistent with the repo.
5. Keep geometry helpers pure and unit-testable.
6. Avoid global mutable state.
7. Do not add heavy dependencies without justification.
8. Use existing lint/test commands if available.
9. Add comments only where geometry/layout decisions need explanation.
10. Keep FLUX isolated behind an adapter so the renderer does not depend on any specific image provider.

Security and safety:
- Reject arbitrary SVG input.
- Reject external URLs in layout data.
- Escape all text labels.
- Do not allow script tags, foreignObject, embedded images, or external references in generated SVG.
- Do not allow model-provided raw path data.
- Do not allow model-provided arrays of points.
- Do not allow unknown component types silently.

Run:
1. The focused vector DSL tests.
2. The existing relevant test suite if practical.
3. Formatting/linting if the repo has commands for them.

Final report:
Return:
1. Files changed.
2. Dependencies added, if any.
3. Test commands run.
4. Test results.
5. Example rendered SVG snippets or artifact paths, if generated.
6. Whether FLUX was called or skipped.
7. Any integration risks.
8. Recommended next production integration step.

Remember:
Do not commit.
Do not integrate into main production pipeline yet.
Do not let the LLM generate raw geometry.
The backend is the geometry source of truth.



include agents.md
