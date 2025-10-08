/**
 * Example test cases for MarkdownRenderer component
 * 
 * This file demonstrates how to test the MarkdownRenderer component.
 * To run these tests, you'll need to set up a testing framework like Jest + React Testing Library.
 */

import { render, screen } from '@testing-library/react';
import MarkdownRenderer from './MarkdownRenderer';

describe('MarkdownRenderer', () => {
  describe('Basic Rendering', () => {
    test('renders simple text content', () => {
      const content = 'Hello, world!';
      render(<MarkdownRenderer content={content} />);
      expect(screen.getByText('Hello, world!')).toBeInTheDocument();
    });

    test('renders markdown headings', () => {
      const content = '# Heading 1\n## Heading 2';
      render(<MarkdownRenderer content={content} />);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Heading 1');
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Heading 2');
    });

    test('renders markdown lists', () => {
      const content = '- Item 1\n- Item 2\n- Item 3';
      render(<MarkdownRenderer content={content} />);
      const listItems = screen.getAllByRole('listitem');
      expect(listItems).toHaveLength(3);
    });

    test('renders markdown links', () => {
      const content = '[Click here](https://example.com)';
      render(<MarkdownRenderer content={content} />);
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', 'https://example.com');
    });
  });

  describe('Datadog %%% Removal', () => {
    test('removes %%% markers from beginning of lines', () => {
      const content = '%%% This is a test\nNormal line';
      render(<MarkdownRenderer content={content} />);
      expect(screen.queryByText('%%%')).not.toBeInTheDocument();
      expect(screen.getByText(/This is a test/)).toBeInTheDocument();
    });

    test('removes %%% markers from end of lines', () => {
      const content = 'This is a test %%%\nNormal line';
      render(<MarkdownRenderer content={content} />);
      expect(screen.queryByText('%%%')).not.toBeInTheDocument();
      expect(screen.getByText(/This is a test/)).toBeInTheDocument();
    });

    test('removes %%% markers from Datadog alert format', () => {
      const datadogContent = `%%% We get high datadog.event.tracking
      
**Metric Graph**: [View](https://example.com)

Monitor triggered at Wed Oct 01 2025
%%%`;
      render(<MarkdownRenderer content={datadogContent} />);
      expect(screen.queryByText('%%%')).not.toBeInTheDocument();
      expect(screen.getByText(/We get high datadog/)).toBeInTheDocument();
    });

    test('keeps %%% when removePercents is false', () => {
      const content = '%%% This is a test %%%';
      render(<MarkdownRenderer content={content} removePercents={false} />);
      expect(screen.getByText(/%%%/)).toBeInTheDocument();
    });
  });

  describe('Size Variants', () => {
    test('applies small size classes', () => {
      const content = '# Heading';
      const { container } = render(<MarkdownRenderer content={content} size="sm" />);
      expect(container.querySelector('.prose-sm')).toBeInTheDocument();
    });

    test('applies base size classes (default)', () => {
      const content = '# Heading';
      const { container } = render(<MarkdownRenderer content={content} />);
      expect(container.querySelector('.prose-sm')).toBeInTheDocument();
    });

    test('applies large size classes', () => {
      const content = '# Heading';
      const { container } = render(<MarkdownRenderer content={content} size="lg" />);
      expect(container.querySelector('.prose')).toBeInTheDocument();
    });
  });

  describe('Custom Styling', () => {
    test('applies custom className', () => {
      const content = 'Test content';
      const { container } = render(
        <MarkdownRenderer content={content} className="custom-class" />
      );
      expect(container.querySelector('.custom-class')).toBeInTheDocument();
    });

    test('applies text color classes', () => {
      const content = 'Test content';
      const { container } = render(
        <MarkdownRenderer 
          content={content} 
          className="text-gray-600 dark:text-gray-400" 
        />
      );
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });
  });

  describe('Code Blocks', () => {
    test('renders inline code', () => {
      const content = 'This is `inline code` example';
      render(<MarkdownRenderer content={content} />);
      const code = screen.getByText('inline code');
      expect(code.tagName).toBe('CODE');
    });

    test('renders code blocks', () => {
      const content = '```javascript\nconst x = 1;\n```';
      const { container } = render(<MarkdownRenderer content={content} />);
      expect(container.querySelector('pre')).toBeInTheDocument();
      expect(container.querySelector('code')).toBeInTheDocument();
    });
  });

  describe('Tables', () => {
    test('renders markdown tables', () => {
      const content = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
      `;
      render(<MarkdownRenderer content={content} />);
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('Header 1')).toBeInTheDocument();
      expect(screen.getByText('Cell 1')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    test('handles null content gracefully', () => {
      const { container } = render(<MarkdownRenderer content={null} />);
      expect(container.firstChild).toBeNull();
    });

    test('handles undefined content gracefully', () => {
      const { container } = render(<MarkdownRenderer content={undefined} />);
      expect(container.firstChild).toBeNull();
    });

    test('handles empty string', () => {
      const { container } = render(<MarkdownRenderer content="" />);
      expect(container.firstChild).toBeNull();
    });

    test('handles very long content', () => {
      const longContent = 'Lorem ipsum '.repeat(1000);
      render(<MarkdownRenderer content={longContent} />);
      expect(screen.getByText(/Lorem ipsum/)).toBeInTheDocument();
    });
  });

  describe('Real-world Examples', () => {
    test('renders Datadog alert description', () => {
      const datadogAlert = `%%% We get high datadog.event.tracking.intakev2.audit.bytes

**Notify**: @webhook-slar

[![Metric Graph](https://example.com/snapshot.png)](https://app.datadoghq.com/monitors/123)

**datadog.event.tracking.intakev2.audit.bytes** over ***** was **> 100.0** on average during the **last 5m**.

The monitor was last triggered at Wed Oct 01 2025 18:37:04 UTC.

---

[[Monitor Status](https://app.datadoghq.com/monitors/123)] · [[Edit Monitor](https://app.datadoghq.com/monitors/123/edit)]
%%%`;

      render(<MarkdownRenderer content={datadogAlert} />);
      
      // Check that %%% is removed
      expect(screen.queryByText('%%%')).not.toBeInTheDocument();
      
      // Check that content is rendered
      expect(screen.getByText(/We get high datadog/)).toBeInTheDocument();
      expect(screen.getByText(/Notify/)).toBeInTheDocument();
      
      // Check that links are rendered
      const links = screen.getAllByRole('link');
      expect(links.length).toBeGreaterThan(0);
    });

    test('renders incident description with code', () => {
      const incidentDesc = `
## Issue Description

The API is returning 500 errors for the following endpoint:

\`\`\`
GET /api/v1/users
\`\`\`

### Steps to Reproduce

1. Call the endpoint
2. Observe the error
3. Check logs

### Error Message

\`\`\`json
{
  "error": "Internal Server Error",
  "code": 500
}
\`\`\`
      `;

      render(<MarkdownRenderer content={incidentDesc} />);
      
      expect(screen.getByText('Issue Description')).toBeInTheDocument();
      expect(screen.getByText('Steps to Reproduce')).toBeInTheDocument();
      expect(screen.getByText(/GET \/api\/v1\/users/)).toBeInTheDocument();
    });
  });
});

