# Scenario-creator usability plan — proposal, no results yet

## Impact hypothesis

Office of Otherwise may help creative scenario builders explore visual and geographic consequences of a what-if, while keeping sourced baseline facts separate from invented outcomes. This is a product hypothesis. No user feedback or usability results have been collected. Curated replays link sources for baseline facts, then separately label changed assumptions, imagined causal steps, uncertainty, and claims those sources do not verify.

## Audience and task

Start with 3–5 adult speculative-fiction writers, worldbuilders, or concept artists. In an offline replay, ask each person to choose one branch, open **Evidence & brief**, compare it with a second path, and use **Save scenario brief** to export a Markdown scenario brief. The participant should be able to explain what the linked sources establish, what the alternate path imagines, and how the map/scene/3D object helps them picture a world concept.

Suggested task prompt:

> “Build a short concept brief from this saved what-if. Choose a path and compare another. Use one linked source to describe the starting-world fact it supports. Then name the changed assumption, summarize two imagined steps, call out one uncertainty, and say what the scene or object communicates about the world. Save the notes and check that the source boundary survives in the brief.”

Target task time: six minutes. Do not coach the participant through the interface or explain the source material. Ask afterward where the spatial presentation helped or distracted, which visual detail they would change, and what they would need before using the brief in their own creative process.

## Small formative pilot

Recruit 3–5 adult creators for moderated usability sessions. This convenience sample can reveal navigation, comprehension, and export problems; it cannot establish market demand or represent all creators. No minors are part of this proposed study. Obtain consent to take notes and quote anonymized comments; do not collect identifying information unless separately consented. Participants can skip questions or stop.

Run `npm run demo:replay`. It binds to loopback, forces replay-only mode, and does not load `.env`; the task uses cached files with no provider calls or paid generation. Identify the chosen story as a counterfactual. Explain that the linked sources ground baseline facts only; they do not establish the imagined path. The 3D object is a saved illustration, not a simulation.

## Success rubric

Score each item 0 or 1 (maximum 5):

| Item | 1 point when the participant… |
|---|---|
| Path selection | Selects one branch and identifies its changed assumption. |
| Baseline source | Uses a linked source to state one baseline fact and identifies the source. |
| Speculative chain | Summarizes two imagined steps without presenting them as sourced history. |
| Visual usefulness | Names a concrete way the globe, scene, or 3D object helps or fails to communicate the concept. |
| Brief boundary | Exports the Markdown notes and can point to both the source note and uncertainty/limit in the brief. |

Pre-register a formative target: at least 80% of participants score 4/5 or higher (round up; for example, 3/3, 4/4, or 4/5), and no participant leaves believing that the baseline sources verify the alternate outcome. Report counts, task times, and observed friction. A missed target calls for a design revision; meeting it in a small pilot is not evidence of broad demand or impact.

## Session observation sheet

```text
Participant code: ______   Date: ______   Consent to notes: yes / no
Task start: ______   Finish: ______   Total minutes: ______

Score: path/assumption __/1 | baseline source __/1 | imagined chain __/1
       visual usefulness __/1 | brief boundary __/1 | total __/5

Where did they hesitate or ask for help?
____________________________________________________________
Which part of the globe, scene, cutout, or 3D object helped or distracted?
____________________________________________________________
Did the exported brief preserve the source/assumption/uncertainty distinction?
____________________________________________________________
What would they change before using this for their own worldbuilding?
____________________________________________________________
Any claim they mistook as source-verified? (describe, no identity)
____________________________________________________________
```

## Reporting

Publish the task, rubric, participant count, completion times, scores, anonymized observations, and limitations only after sessions happen and consent permits it. Separate observed usability from stated intent to use the tool. Do not claim user feedback, market validation, or learning outcomes before there is evidence for them.
