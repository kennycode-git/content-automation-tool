/**
 * PromptModal.tsx
 * Shows an example AI prompt for generating classic-text batch lists.
 * {placeholders} are highlighted in brand colour.
 */

import { useState } from 'react'

type PromptMode = 'images' | 'clips' | 'layered'

const IMAGE_PROMPT_TEXT = `Create {NUMBER} searchable image lists about {TOPIC(S)} in the exact format below. Output nothing except the lists - no intro, no commentary, no explanations.

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

- If user says "too generic" -> increase specificity, remove common objects, add unusual details
- If user says "too repetitive" -> you failed rule #1, regenerate with stricter word tracking
- If user provides aesthetic guidance (dark/gothic/bright/minimal) -> apply to ALL searchables
- For colour-specific folders -> include colour word in EVERY searchable
- For philosopher series -> ensure thematic progression while maintaining zero repetition

**Output only the formatted lists. Nothing else.**`

const CLIPS_PROMPT_TEXT = `Create {NUMBER} short stock-footage search lists about {TOPIC(S)} in the exact format below. Output nothing except the lists - no intro, no commentary, no explanations.

\`\`\`
# {First Title}
search term one
search term two
search term three

# {Second Title}
search term one
search term two
search term three
\`\`\`

**Rules:**

1. **THREE SEARCH TERMS ONLY**
   - Each list must contain exactly 3 search terms
   - No extra lines, notes, or variations

2. **WRITE FOR VIDEO CLIPS**
   - Every search term must describe motion, atmosphere, or a filmable scene
   - Think in footage, not still photos
   - Good examples: \`stargazing under clear night sky\`, \`earth rotating from space\`, \`moonlit clouds drifting slowly\`

3. **KEEP IT SHORT**
   - Each search term should be 3-6 words
   - Shorter phrases search better on stock video libraries

4. **MAKE IT CINEMATIC**
   - Lean toward moody, visual, high-production scenes
   - Use words that suggest motion, scale, light, weather, or texture

5. **STAY SEARCHABLE**
   - Keep terms natural enough for stock footage sites
   - Avoid abstract language that would return weak results

6. **AVOID REPETITION**
   - Do not repeat the exact same phrase across lists
   - Make each list feel distinct while staying on theme

7. **TITLE FORMAT**
   - Use \`# Title\` format
   - Keep titles clean and specific

8. **SELF-CHECK BEFORE OUTPUT**
   - Are all terms suitable for stock video footage?
   - Are they short, cinematic, and easy to search?
   - Does every list contain exactly 3 terms?

**Output only the formatted lists. Nothing else.**`

interface Props {
  onClose: () => void
  fromTour?: boolean
  mode?: PromptMode
}

export default function PromptModal({ onClose, fromTour, mode = 'images' }: Props) {
  const [copied, setCopied] = useState(false)

  const promptText = mode === 'clips' ? CLIPS_PROMPT_TEXT : IMAGE_PROMPT_TEXT
  const title = mode === 'clips' ? 'AI clip prompt' : 'AI batch prompt'
  const footerText =
    mode === 'clips'
      ? 'Then paste the output into Classic text mode for Video Clips'
      : 'Then paste the output into Classic text mode'

  function handleCopy() {
    navigator.clipboard.writeText(promptText)
    setCopied(true)
  }

  function renderHighlighted(text: string) {
    return text.split(/(\{[^}]+\})/).map((part, i) =>
      part.startsWith('{') && part.endsWith('}')
        ? <span key={i} className="rounded bg-brand-500/20 px-0.5 font-semibold text-brand-400">{part}</span>
        : <span key={i}>{part}</span>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-stone-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-800 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-stone-100">{title}</h2>
            <p className="mt-0.5 text-xs text-stone-500">
              Paste into ChatGPT or Claude and edit the{' '}
              <span className="font-semibold text-brand-400">{'{highlighted}'}</span>{' '}
              parts first.
            </p>
          </div>
          <button onClick={onClose} className="text-lg leading-none text-stone-500 transition hover:text-stone-200">×</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-stone-300">
            {renderHighlighted(promptText)}
          </pre>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-stone-800 px-5 py-3">
          {copied && fromTour ? (
            <>
              <p className="text-xs text-stone-400">Copied. Paste into ChatGPT or Claude</p>
              <button
                onClick={onClose}
                className="shrink-0 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
              >
                Return to tutorial
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-stone-600">{footerText}</p>
              <button
                onClick={handleCopy}
                className="shrink-0 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
              >
                {copied ? 'Copied' : 'Copy prompt'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
