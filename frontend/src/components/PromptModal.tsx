/**
 * PromptModal.tsx
 * Shows an example AI prompt for generating classic-text batch lists.
 * {placeholders} are highlighted in brand colour.
 */

import { useState } from 'react'

const PROMPT_TEXT = `Create {NUMBER} searchable image lists about {TOPIC(S)} in the exact format below. Output nothing except the lists — no intro, no commentary, no explanations.

\`\`\`
# {First Title}
search term one
search term two
search term three
...
search term fifteen

# {Second Title}
search term one
search term two
search term three
...
search term fifteen
\`\`\`

**Rules:**

1. **ZERO WORD REPETITION**
   - Track every word used across ALL lists in the batch
   - Never reuse the same word twice across the entire output
   - If generating 3 lists with 15 items each = 45 unique searchables with zero repeated words

2. **SEARCHABLE STRUCTURE**
   - Each searchable is 4-8 words describing a single visual image
   - Format: [subject] [descriptor] [tone/color] [detail] [atmosphere] [context]
   - Example: \`marble bust philosopher weathered stone contemplative shadows\`
   - NOT: \`philosopher thinking\` (too generic, too short)

3. **VISUAL CONCRETENESS**
   - Every searchable must describe something photographable or illustratable
   - Avoid abstract concepts - use concrete objects, scenes, symbols
   - Ask: "Could I find this exact image on Unsplash/Pexels?"

4. **TOPIC RELEVANCE**
   - Connect searchables to the specific topic/philosopher/theme requested
   - Use biographical details, historical context, key concepts, symbols
   - Reference specific texts, events, or iconography when applicable

5. **AESTHETIC CONSISTENCY**
   - Maintain consistent visual tone across all lists (user will specify: dark academia, minimalist, vibrant, etc.)
   - Include tone/mood descriptors in each searchable
   - Default to cinematic, atmospheric, symbolic imagery unless told otherwise

6. **TITLE FORMAT**
   - Use \`# Title\` format
   - Titles should be specific: \`Carl Jung Shadow Integration\` not just \`Jung\`
   - For series: \`Nietzsche Part 1: Death of God\` format

7. **NO GENERIC STOCK PHOTOS**
   - Avoid: corporate office, smiling people, bright motivational imagery
   - Avoid: common objects without context (apple, flower, sky)
   - Add specificity: \`crimson fabric flowing weighted draped\` not \`red cloth\`

8. **SEARCHABILITY BALANCE**
   - Terms must be discoverable on stock sites
   - Don't be so specific that zero results return
   - Test mentally: "Would Unsplash have this image?"

9. **WORD COUNT FLEXIBILITY**
   - 8-15 searchables per list is standard
   - Can adjust to 10, 20, or other if specifically requested
   - Always confirm number before generating

10. **SELF-CHECK BEFORE OUTPUT**
    - Did I repeat ANY word across the entire batch?
    - Are these visually concrete and searchable?
    - Do they connect to the topic?
    - Do they maintain consistent aesthetic?
    - Are they specific enough to avoid generic results?

11. **ENSURE HASHTAGS ARE AT THE START OF EACH TITLE**
    - Output the lists inside a code block to guarantee the \`#\` symbol is preserved as a literal character, not rendered as a heading
    - Every title line must begin with exactly \`# \` followed by the title text
    - Double-check before outputting: every list must start with \`# Title\`

**Special Instructions:**

- If user says "too generic" → increase specificity, remove common objects, add unusual details
- If user says "too repetitive" → you failed rule #1, regenerate with stricter word tracking
- If user provides aesthetic guidance (dark/gothic/bright/minimal) → apply to ALL searchables
- For color-specific folders → include color word in EVERY searchable
- For philosopher series → ensure thematic progression while maintaining zero repetition

**Output only the formatted lists. Nothing else.**`

interface Props {
  onClose: () => void
  fromTour?: boolean
}

export default function PromptModal({ onClose, fromTour }: Props) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(PROMPT_TEXT)
    setCopied(true)
  }

  function renderHighlighted(text: string) {
    return text.split(/(\{[^}]+\})/).map((part, i) =>
      part.startsWith('{') && part.endsWith('}')
        ? <span key={i} className="bg-brand-500/20 text-brand-400 rounded px-0.5 font-semibold">{part}</span>
        : <span key={i}>{part}</span>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-stone-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
          <div>
            <h2 className="text-sm font-semibold text-stone-100">AI batch prompt</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Paste into ChatGPT or Claude (any LLM) and edit the{' '}
              <span className="text-brand-400 font-semibold">{'{highlighted}'}</span>{' '}
              parts first.
            </p>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200 transition text-lg leading-none">✕</button>
        </div>
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          <pre className="text-xs text-stone-300 leading-relaxed font-mono whitespace-pre-wrap">
            {renderHighlighted(PROMPT_TEXT)}
          </pre>
        </div>
        <div className="px-5 py-3 border-t border-stone-800 flex items-center justify-between gap-3">
          {copied && fromTour ? (
            <>
              <p className="text-xs text-stone-400">✓ Copied. Paste into ChatGPT or Claude (any LLM)</p>
              <button
                onClick={onClose}
                className="shrink-0 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700 transition"
              >
                Return to tutorial →
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-stone-600">Then paste the output into Classic text mode</p>
              <button
                onClick={handleCopy}
                className="shrink-0 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700 transition"
              >
                {copied ? '✓ Copied!' : 'Copy prompt'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
