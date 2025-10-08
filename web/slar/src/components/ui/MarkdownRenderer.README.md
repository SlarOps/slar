# MarkdownRenderer Component

A reusable React component for rendering markdown content with consistent styling across the SLAR application.

## Features

- ✅ **GitHub Flavored Markdown (GFM)** support via `remark-gfm`
- ✅ **Syntax highlighting** for code blocks via `rehype-highlight`
- ✅ **Dark mode** support with Tailwind CSS
- ✅ **Automatic cleanup** of `%%%` markers from Datadog alerts
- ✅ **Responsive sizing** with three size variants (sm, base, lg)
- ✅ **Consistent styling** across all markdown elements

## Installation

The component is already included in the UI components export:

```javascript
import { MarkdownRenderer } from '../components/ui';
```

## Usage

### Basic Usage

```jsx
import { MarkdownRenderer } from '../components/ui';

function MyComponent() {
  const content = `
# Hello World

This is **bold** and this is *italic*.

- List item 1
- List item 2
  `;

  return <MarkdownRenderer content={content} />;
}
```

### With Size Variants

```jsx
// Small size (for cards, compact views)
<MarkdownRenderer 
  content={description}
  size="sm"
/>

// Base size (default, for most content)
<MarkdownRenderer 
  content={description}
  size="base"
/>

// Large size (for main content areas)
<MarkdownRenderer 
  content={description}
  size="lg"
/>
```

### With Custom Styling

```jsx
<MarkdownRenderer 
  content={description}
  size="base"
  className="text-gray-600 dark:text-gray-400 mb-4"
/>
```

### Disable %%% Removal

By default, the component removes `%%%` markers (common in Datadog alerts). To disable this:

```jsx
<MarkdownRenderer 
  content={description}
  removePercents={false}
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `string` | - | **Required.** The markdown content to render |
| `size` | `'sm' \| 'base' \| 'lg'` | `'base'` | Size variant for typography and spacing |
| `className` | `string` | `''` | Additional CSS classes to apply to the wrapper |
| `removePercents` | `boolean` | `true` | Whether to remove `%%%` markers from content |

## Size Variants

### Small (`sm`)
- Compact spacing and smaller typography
- Ideal for: Alert cards, compact lists, sidebars
- Font sizes: h1/h2 (text-sm), h3 (text-xs)

### Base (`base`)
- Standard spacing and typography
- Ideal for: Incident details, modal content, main descriptions
- Font sizes: h1 (text-lg), h2 (text-base), h3 (text-sm)

### Large (`lg`)
- Generous spacing and larger typography
- Ideal for: Main content areas, documentation, articles
- Font sizes: h1 (text-xl), h2 (text-lg), h3 (text-base)

## Supported Markdown Elements

- **Headings**: h1-h6
- **Paragraphs**: with proper line height
- **Lists**: ordered and unordered
- **Links**: with hover effects
- **Code**: inline and code blocks with syntax highlighting
- **Blockquotes**: with left border styling
- **Tables**: with borders and proper spacing
- **Images**: responsive with rounded corners
- **Horizontal rules**: with proper spacing
- **Bold/Italic**: standard markdown emphasis

## Examples

### Datadog Alert Description

```jsx
// Datadog sends descriptions with %%% markers
const datadogDescription = `
%%% We get high datadog.event.tracking.intakev2.audit.bytes

**Metric Graph**: [View Graph](https://example.com)

The monitor was last triggered at Wed Oct 01 2025 18:37:04 UTC.
%%%
`;

// Component automatically removes %%% markers
<MarkdownRenderer content={datadogDescription} />
```

### Code Block with Syntax Highlighting

```jsx
const codeExample = `
\`\`\`javascript
function hello() {
  console.log("Hello, world!");
}
\`\`\`
`;

<MarkdownRenderer content={codeExample} />
```

### Table

```jsx
const tableContent = `
| Service | Status | Uptime |
|---------|--------|--------|
| API     | ✅ Up  | 99.9%  |
| DB      | ✅ Up  | 99.8%  |
`;

<MarkdownRenderer content={tableContent} />
```

## Current Usage

The component is currently used in:

1. **`/app/incidents/[id]/page.js`** - Incident detail page
2. **`/components/incidents/IncidentDetailModal.js`** - Incident modal
3. **`/components/alerts/AlertCard.js`** - Alert cards
4. **`/app/alerts/[id]/page.js`** - Alert detail page

## Styling Customization

All styling is done via Tailwind CSS classes. To customize:

1. Modify the `sizeConfig` object in `MarkdownRenderer.js`
2. Update component-specific classes in the `components` prop
3. Add custom classes via the `className` prop

## Dependencies

- `react-markdown` - Core markdown rendering
- `remark-gfm` - GitHub Flavored Markdown support
- `rehype-highlight` - Syntax highlighting for code blocks
- `highlight.js` - Syntax highlighting library

## Notes

- The component uses `prose` classes from Tailwind Typography (if available)
- All links open in the same tab by default (add `target="_blank"` in markdown if needed)
- Images are automatically responsive and have rounded corners
- Code blocks use the GitHub CSS theme for syntax highlighting

