---
name: rewrite-slop
description: Rewrite AI-generated, stiff, generic, choppy, resume-like, or over-polished prose into the user's natural authorial voice while preserving the intended meaning, facts, genre, and constraints. Use when the user asks to rewrite, humanize, de-slop, refine a brain dump, make writing sound like them, make prose less AI-generated, make a draft less listy or more fluent, or revise application essays, reflections, academic responses, and similar personal writing.
---

# Rewrite Slop

Read `references/voice-profile.md` in full before rewriting. Treat it as the authoritative description of the user's voice.

## Goal

Make the prose sound as though the user thought it through and wrote it carefully themselves. Preserve the intelligence and nuance of the idea without laundering it into generic professional language. The result should be fluent, specific, lightly conversational, and recognizably personal.

## Workflow

1. Extract the non-negotiable content: central claim, facts, examples, requested length, audience, and genre. When earlier and user-edited drafts are available, treat the latest user edits as the strongest voice evidence. Separate deliberate choices from typos, factual errors, and assignment-specific permissions.
2. Diagnose the slop. Look for resume inventories, generic abstractions, stiff signposting, ornamental polish, repeated sentence shapes, stacked descriptors, choppy claims, and conclusions that merely summarize.
3. Decide what the paragraph is actually about. Build around that one idea and cut facts that only prove the user has done many things. Preserve details that explain how the user reached the view, even when they make the paragraph longer. Preserving meaning does not require preserving every fact in the source.
4. Select the smallest number of examples needed. Develop the strongest example enough for the reader to understand what happened and why it mattered.
5. Rebuild the logic before polishing sentences. Each sentence should naturally cause, qualify, contrast with, or interpret the previous one.
6. Run a voice pass using the reference profile.
7. Run a restraint pass. Remove anything that sounds grander, tidier, or more certain than the user's own thinking.
8. Run a literal triad scan. Rewrite rhetorical structures of the form `A, B, and C`, including three parallel verbs, benefits, adjectives, examples, or settings. If all three facts are necessary, distribute them naturally or make one causally subordinate rather than preserving the three-beat cadence.
9. Check factual fidelity, grammar, length, and requested formatting.

## Core Rewrite Rules

- Lead with the real claim or preference in plain first-person language.
- Favor connected sentences with visible cause and effect over a row of short declarations.
- Use concrete context that earns the interpretation. Prefer one revealing detail over several credentials.
- Do not open a paragraph by inventorying credentials or settings. By default, name at most one experience, employer, or project in a paragraph. Mention more only when the paragraph's actual point depends on their contrast.
- If the source only gives a list of experiences without enough detail to develop one, compress the list into an honest category such as `across my work in research and industry`. Do not march through every item.
- Move from experience to what the user noticed, then to what that reveals about the larger point.
- Preserve useful tension. The user's strongest writing often holds two true ideas together instead of resolving them too neatly.
- Preserve the user's position through qualifications. Correct a false premise and acknowledge relevant counterevidence without replacing a defensible, unpopular view with a more conventional conclusion. Distinguish what is established from what the user suspects or feels.
- Keep subjective qualifiers such as `I think`, `honestly`, `pretty`, `just`, `somewhat`, and `I feel like` when they convey real perspective. Do not scatter them mechanically.
- Allow mild, ordinary phrasing and contractions. Human voice comes from natural judgment and specificity, not inserted slang or deliberate errors.
- Keep supplied humor, parenthetical reactions, and candid admissions when they reveal a judgment and fit the audience. Do not add profanity or copy one response paper's casual register into every genre.
- Repeat an important plain word when it is the clearest word. Do not perform synonym swaps merely to appear polished.
- End when the thought lands. A short implication is usually stronger than a ceremonial conclusion.
- When strengthening a reflective ending, state the specific assumption that changed or the person the user now understands differently. Build the connection through that realization; do not equate a real person with a literary character merely to close the loop.

## Remove or Rebuild

- Em dashes.
- Decorative rules of three and stacked adjectives or adverbs.
- Three-part verb, benefit, or value lists copied from the source. Keep the central item or convert the relationship into cause and effect; do not replace one triad with another.
- Resume-like sequences of projects, employers, achievements, or technologies.
- Generic phrases such as `this experience reinforced my passion`, `at the intersection of`, `I was able to leverage`, `deeply resonated`, `underscored the importance`, and `meaningful impact` when the sentence does not show the meaning.
- Vague endings such as `problems that matter`, `make a difference`, or `change the world` when the paragraph can name the actual user, outcome, or reason instead.
- Stock contrast frames such as `not only ... but also` and `more than just ...` unless the user's source genuinely depends on that distinction.
- Formal transitions such as `moreover`, `furthermore`, and `additionally` when `but`, `so`, `because`, or a direct sentence works better.
- Inflated claims about humanity, innovation, transformation, or the future that are not necessary to answer the prompt.
- Perfectly symmetrical paragraphs in which every example receives equal space.
- A final paragraph that repeats the thesis, lists skills, and restates organization fit. Keep only the connective idea that earns its place.

## Fidelity and Genre

- Do not invent anecdotes, motives, emotions, facts, or sensory details.
- Treat calibration examples as evidence of style, not as a bank of personal facts to reuse in unrelated drafts. In literary responses, connect a scene to the user's reaction without inventing character history or presenting a speculative motive as fact.
- Correct typos and broken grammar without sanding away the user's cadence.
- Preserve necessary technical language. Simplify corporate or academic filler, not the subject matter itself.
- Match the genre. A personal reflection can carry more candid qualifiers; an application answer should be direct and selective; an analytical assignment should state evidence and uncertainty plainly.
- Preserve citations, quotations, names, numbers, and formatting unless the user asks to change them.
- Honor the requested length. When shortening, cut duplicate framing and weak examples before compressing the strongest idea.
- For an informal response paper, let the user's reaction organize the piece. Use only the plot context needed to make the reaction intelligible; include quotations and formal references when required or when they materially help. Keep source-checking notes out of the prose unless requested. Check length even when a voice sample itself exceeds the assignment limit.
- When source material is a brain dump, infer the core throughline but do not treat every detail as mandatory.

## Output

Return the complete revised text with no prefatory explanation unless the user asks for commentary, alternatives, or a change log. Preserve paragraph divisions when they reflect the argument; otherwise, reorganize them for flow.
