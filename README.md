# Persistent Task Reminder for Obsidian

## Overview

**Persistent Task Reminder** is a helper plugin for Obsidian designed to work together with the **Tasks** plugin and the **Reminder** plugin.

The goal of this plugin is simple:

> Let users write normal Tasks-style tasks with a start date and a due date, and automatically generate Reminder-compatible reminder times between those dates.

Instead of manually adding `⏰` to every task, the user only writes:

```markdown
- [ ] Write methodology section 🛫 2026-08-12 📅 2026-08-20
```

The plugin automatically inserts or updates a reminder field:

```markdown
- [ ] Write methodology section 🛫 2026-08-12 ⏰ 2026-08-12 09:00 📅 2026-08-20
```

The **Reminder** plugin then handles the actual notification.

---

## Motivation

The Obsidian Tasks plugin is useful for managing tasks with metadata such as:

```markdown
🛫 start date
📅 due date
```

However, Tasks itself does not provide repeated notifications between the start date and the deadline.

The Reminder plugin can send notifications, but it requires a reminder marker such as:

```markdown
⏰ 2026-08-12 09:00
```

Manually adding and updating this field for every task is tedious.

This plugin solves that problem by automatically maintaining the `⏰` field based on the task’s `🛫` start date and `📅` due date.

---

## Basic Idea

The user writes a normal task:

```markdown
- [ ] Read paper 🛫 2026-08-12 📅 2026-08-15
```

The helper plugin checks:

1. Is this an unfinished task?
2. Does it have a start date?
3. Does it have a due date?
4. Is today between the start date and the due date?
5. Does the task need a reminder?

If yes, the plugin inserts or updates the reminder field:

```markdown
- [ ] Read paper 🛫 2026-08-12 ⏰ 2026-08-12 09:00 📅 2026-08-15
```

Later, after the reminder time has passed, the plugin updates the reminder to the next configured reminder time:

```markdown
- [ ] Read paper 🛫 2026-08-12 ⏰ 2026-08-12 12:00 📅 2026-08-15
```

Then:

```markdown
- [ ] Read paper 🛫 2026-08-12 ⏰ 2026-08-12 15:00 📅 2026-08-15
```

This continues until the task is completed or the due date has passed.

---

## Intended Workflow

The user only needs to write:

```markdown
- [ ] Work on synthetic population validation 🛫 2026-08-12 📅 2026-08-20
```

The plugin handles:

```markdown
⏰ next reminder time
```

The Reminder plugin handles:

```text
notification popup
system notification
reminder behavior
```

The Tasks plugin handles:

```text
task querying
task completion
start date
due date
```

The three plugins work together:

```text
Tasks plugin
    manages task metadata

Persistent Task Reminder
    automatically maintains ⏰ reminder times

Reminder plugin
    sends notifications
```

---

## Example

### Original task

```markdown
- [ ] Draft PhD research plan 🛫 2026-08-12 📅 2026-08-18
```

### Plugin settings

```text
First reminder time: 09:00
Last reminder time: 21:00
Repeat every: 3 hours
```

### Generated reminder schedule

```text
2026-08-12 09:00
2026-08-12 12:00
2026-08-12 15:00
2026-08-12 18:00
2026-08-12 21:00
2026-08-13 09:00
...
2026-08-18 21:00
```

The task line is continuously updated so that the Reminder plugin always sees the next upcoming reminder.

---

## Supported Syntax

The plugin looks for unfinished Markdown tasks with this structure:

```markdown
- [ ] Task name 🛫 YYYY-MM-DD 📅 YYYY-MM-DD
```

For example:

```markdown
- [ ] Analyze survey data 🛫 2026-08-12 📅 2026-08-20
```

The plugin inserts:

```markdown
⏰ YYYY-MM-DD HH:mm
```

before the due date field:

```markdown
- [ ] Analyze survey data 🛫 2026-08-12 ⏰ 2026-08-12 09:00 📅 2026-08-20
```

This placement is intentional, because the Reminder plugin expects the reminder field to be close to the due date field when using Tasks-style syntax.

---

## Manual Reminders

If a task already contains a manually written reminder, the plugin should not overwrite it.

For example:

```markdown
- [ ] Submit abstract ⏰ 2026-08-20 17:00 🛫 2026-08-12 📅 2026-08-20
```

This reminder was written manually by the user.

The plugin should leave it unchanged unless the plugin itself originally created and managed that reminder.

This prevents accidental overwriting of important manual reminders.

---

## Completion Behavior

When the task is completed:

```markdown
- [x] Draft PhD research plan 🛫 2026-08-12 ⏰ 2026-08-12 15:00 📅 2026-08-18
```

the plugin should stop managing reminders for that task.

Optionally, the plugin may remove the automatically generated reminder field:

```markdown
- [x] Draft PhD research plan 🛫 2026-08-12 📅 2026-08-18
```

This keeps completed tasks clean.

---

## Settings

The plugin should provide a settings page in Obsidian.

### First reminder time

The first reminder time for each active day.

Example:

```text
09:00
```

This means the first daily reminder will be scheduled at 09:00.

---

### Last reminder time

The final reminder time for each active day.

Example:

```text
21:00
```

This means the plugin will not create reminders after 21:00.

---

### Repeat interval

How often the reminder should repeat.

Example:

```text
Every 3 hours
```

With a first reminder time of 09:00 and a last reminder time of 21:00, the generated reminder times would be:

```text
09:00
12:00
15:00
18:00
21:00
```

---

### Grace period

The number of minutes to wait after a reminder time before updating it to the next reminder time.

Example:

```text
3 minutes
```

This prevents the helper plugin from updating the reminder too quickly before the Reminder plugin has had time to trigger the notification.

---

### Scan interval

How often the plugin scans Markdown files for tasks.

Example:

```text
Every 10 minutes
```

A shorter interval updates reminders more quickly, but may be less efficient for large vaults.

---

## Technical Design

The plugin is written in **TypeScript**, the standard language for Obsidian community plugin development.

The plugin does not need to depend on the internal API of the Tasks plugin. Instead, it reads Markdown task lines directly.

This makes the plugin simpler and less likely to break if the Tasks plugin changes internally.

---

## Core Algorithm

The core logic is:

```text
For every Markdown file:
    Read each line

    If the line is an unfinished task:
        Check whether it has 🛫 start date
        Check whether it has 📅 due date

        If both dates exist:
            Check whether today is inside the active window

            If there is no reminder:
                Insert the next reminder time

            If there is a managed reminder that has passed:
                Update it to the next reminder time

    If the line is a completed task:
        Stop managing its reminder
```

---

## Reminder Calculation

The plugin computes the next reminder using:

```text
start date
due date
first reminder time
last reminder time
repeat interval
current time
```

For example:

```text
Start date: 2026-08-12
Due date: 2026-08-20
First reminder: 09:00
Last reminder: 21:00
Repeat every: 3 hours
Current time: 2026-08-12 14:20
```

The next valid reminder is:

```text
2026-08-12 15:00
```

So the task becomes:

```markdown
- [ ] Write chapter 🛫 2026-08-12 ⏰ 2026-08-12 15:00 📅 2026-08-20
```

---

## Plugin Files

A basic plugin structure may look like this:

```text
persistent-task-reminder/
├── manifest.json
├── package.json
├── main.js
├── styles.css
└── src/
    └── main.ts
```

For a more organized version:

```text
persistent-task-reminder/
├── manifest.json
├── package.json
├── main.js
├── styles.css
└── src/
    ├── main.ts
    ├── settings.ts
    ├── task-parser.ts
    ├── reminder-manager.ts
    └── types.ts
```

---

## Installation for Local Development

The plugin should be placed inside the vault’s plugin folder:

```text
VaultName/.obsidian/plugins/persistent-task-reminder/
```

Then install dependencies:

```bash
npm install
```

Start development mode:

```bash
npm run dev
```

After compilation, enable the plugin in Obsidian:

```text
Settings → Community plugins → Installed plugins → Persistent Task Reminder
```

---

## Required Companion Plugins

This plugin is designed to be used together with:

1. **Tasks**
2. **Reminder**

The Tasks plugin provides task metadata such as:

```markdown
🛫 start date
📅 due date
```

The Reminder plugin provides actual notification behavior using:

```markdown
⏰ reminder date and time
```

Persistent Task Reminder connects the two.

---

## Limitations

This plugin is not intended to replace the Reminder plugin.

It does not directly create native operating system notifications. Instead, it maintains reminder metadata so that the Reminder plugin can handle notifications.

The plugin only works while Obsidian is running. If Obsidian is fully closed, the helper plugin cannot update reminder times.

The first version only supports simple Markdown task lines. More advanced task structures may require additional parsing later.

---

## Design Philosophy

The plugin should be simple, predictable, and non-destructive.

It should not force the user to learn a new task syntax.

The user should continue writing normal Tasks-style tasks:

```markdown
- [ ] Task name 🛫 start-date 📅 due-date
```

The plugin should quietly maintain the reminder field:

```markdown
⏰ next-reminder-time
```

The final goal is to reduce friction.

The user should not need to manually tap or type the reminder symbol for every task.

---

## Future Features

Possible future improvements include:

```text
Snooze support
Better detection of manually written reminders
Clickable notification actions
Per-task reminder intervals
Folder-level settings
Ignore specific files or folders
Support for overdue reminders
Support for scheduled date ⏳
Better integration with Tasks queries
Command to clean all generated reminders
```

A future version could also support custom inline syntax such as:

```markdown
- [ ] Write article 🛫 2026-08-12 📅 2026-08-20 🔁remind every 2h
```

But this should be optional. The default workflow should remain simple.

---

## Summary

Persistent Task Reminder is a small bridge plugin for Obsidian.

It allows the user to write:

```markdown
- [ ] Task name 🛫 start-date 📅 due-date
```

and automatically maintains:

```markdown
⏰ next-reminder-time
```

This makes the Reminder plugin behave as if the task has repeated reminders from the start date until the deadline, without requiring the user to manually add reminder metadata every time.

The main benefit is a cleaner task workflow:

```text
Write once.
Get reminded repeatedly.
Stop when done.
```
