import { renderMarkdown } from './utils/markdown.js';

const markdownContent = `
# Markdown + KaTeX + Highlight.js 示例

## 代码高亮示例

### JavaScript 代码
\`\`\`javascript
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// 测试
console.log(fibonacci(10)); // 55
\`\`\`

### Python 代码
\`\`\`python
def quick_sort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quick_sort(left) + middle + quick_sort(right)
\`\`\`

### CSS 代码
\`\`\`css
.markdown-body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  line-height: 1.6;
  padding: 20px;
}

.markdown-body pre {
  background-color: #f6f8fa;
  border-radius: 3px;
  padding: 16px;
  overflow: auto;
}
\`\`\`

### HTML 代码
\`\`\`html
<div class="container">
  <h1>Hello World</h1>
  <p>This is a paragraph.</p>
</div>
\`\`\`

### Bash 命令
\`\`\`bash
npm install marked katex highlight.js
npm run dev
\`\`\`

## 数学公式示例

行内公式：$E = mc^2$ 和 \\(\\int_0^1 x^2 dx = \\frac{1}{3}\\)

块级公式：
$$
\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
$$

矩阵示例：
$$
\\begin{pmatrix}
a & b \\\\
c & d
\\end{pmatrix}
$$

## 混合使用

在代码中也可以包含数学公式说明：

\`\`\`javascript
// 计算二次方程的解
// 公式：x = (-b ± √(b² - 4ac)) / 2a
function solveQuadratic(a, b, c) {
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  
  const sqrtDisc = Math.sqrt(discriminant);
  const x1 = (-b + sqrtDisc) / (2 * a);
  const x2 = (-b - sqrtDisc) / (2 * a);
  
  return [x1, x2];
}
\`\`\`
`;

export async function init() {
  const container = document.getElementById('mark-test');
  if (container) {
    const html = await renderMarkdown(markdownContent);
    container.innerHTML = html;
  }
}