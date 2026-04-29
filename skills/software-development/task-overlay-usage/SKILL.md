---
name: task-overlay-usage
description: Use when working with Pi's task overlay extension or when the agent needs a reminder for how to create, sync, update, and persist tasks in the generic task system.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [software-development, pi, tasks, overlay, planning]
    related_skills: [hermes-agent-skill-authoring, writing-plans]
---

# Task Overlay Usage

## Overview

This skill is the agent-facing reference for Pi's task overlay feature. It explains how to feed generic task input into the system, how to keep the overlay synchronized with ongoing work, and how to avoid assuming a specialized plan format.

Use this skill whenever the conversation is about task tracking, planning, progress sync, task-panel rendering, or integrating upstream planning tools into Pi.

## When to Use

- The user asks to add, update, complete, block, remove, show, or hide tasks in Pi
- The user wants the floating task overlay to stay in sync with agent work
- The user wants upstream planners to send tasks without a custom plan schema
- The user asks how to invoke or use the task-overlay feature correctly
- You need a quick reminder of the extension's task store, normalization, or panel behavior

Do not use this skill for unrelated codebase work.

## Quick Start

1. Load this skill before answering task-overlay questions.
2. Treat the task store as the source of truth.
3. Accept generic task input first; normalize it into canonical tasks.
4. Keep the overlay updated as tasks change.
5. Persist task events through the session-backed task store so the UI can recover after refresh/restart.
6. If you encounter more work, update the task list first.

## Supported Task Input

The task system is intentionally generic. Upstream tools may provide any of these forms:

- Raw text
- Markdown checklists
- Numbered lists
- JSON objects
- Arrays of task objects
- Mixed planning notes that can be normalized into tasks

Normalization should extract stable task identities where possible, but it should not require a special "plan" format.

## Core Actions

The task overlay should support these operations conceptually:

- sync: replace or merge a task set from upstream input
- upsert: create or update a task
- update: change title, notes, status, priority, or metadata
- complete: mark a task done
- block / unblock: toggle blocked state
- remove: delete a task
- clear: delete all tasks
- activate: focus the task in the overlay
- show / hide: control panel visibility
- snapshot: inspect the current canonical state

When explaining behavior to the user, prefer these generic verbs rather than plan-specific wording.

## How the Agent Should Behave

- Keep the canonical task list synchronized with actual work
- If a task changes, update the overlay immediately rather than waiting until the end
- Prefer concise task names and stable IDs
- Preserve user-supplied structure when it is useful, but normalize it into the task store
- Do not require the user to rewrite their tasks into a custom format