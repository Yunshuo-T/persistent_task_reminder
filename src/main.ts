import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";

interface PersistentTaskReminderSettings {
	defaultReminderTime: string; // HH:mm
	activeEndTime: string; // HH:mm
	repeatEveryHours: number;
	graceMinutes: number;
	scanIntervalMinutes: number;
}

interface PersistentTaskReminderData {
	settings: PersistentTaskReminderSettings;
	managedTaskKeys: Record<string, boolean>;
}

const DEFAULT_SETTINGS: PersistentTaskReminderSettings = {
	defaultReminderTime: "09:00",
	activeEndTime: "21:00",
	repeatEveryHours: 3,
	graceMinutes: 3,
	scanIntervalMinutes: 10,
};

const UNCHECKED_TASK_RE = /^(\s*[-*]\s+\[ \]\s*)(.*)$/;
const COMPLETED_TASK_RE = /^(\s*[-*]\s+\[[xX]\]\s*)(.*)$/;

const START_RE = /🛫\s*(\d{4}-\d{2}-\d{2})/;
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const REMINDER_RE =
	/⏰\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/;
const DONE_RE = /✅\s*\d{4}-\d{2}-\d{2}/;

export default class PersistentTaskReminderPlugin extends Plugin {
	settings: PersistentTaskReminderSettings = DEFAULT_SETTINGS;
	managedTaskKeys: Record<string, boolean> = {};

	async onload() {
		await this.loadPluginData();

		this.addSettingTab(
			new PersistentTaskReminderSettingTab(this.app, this)
		);

		this.addCommand({
			id: "sync-persistent-task-reminders",
			name: "Sync persistent task reminders now",
			callback: async () => {
				await this.syncAllMarkdownFiles();
				new Notice("Persistent task reminders synced.");
			},
		});

		this.registerInterval(
			window.setInterval(() => {
				void this.syncAllMarkdownFiles();
			}, this.settings.scanIntervalMinutes * 60 * 1000)
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					void this.syncFile(file);
				}
			})
		);

		await this.syncAllMarkdownFiles();
	}

	async loadPluginData() {
		const data =
			(await this.loadData()) as PersistentTaskReminderData | null;

		this.settings = {
			...DEFAULT_SETTINGS,
			...(data?.settings ?? {}),
		};

		this.managedTaskKeys = data?.managedTaskKeys ?? {};
	}

	async savePluginData() {
		const data: PersistentTaskReminderData = {
			settings: this.settings,
			managedTaskKeys: this.managedTaskKeys,
		};

		await this.saveData(data);
	}

	async syncAllMarkdownFiles() {
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			await this.syncFile(file);
		}
	}

	async syncFile(file: TFile) {
		let changed = false;
		let stateChanged = false;

		await this.app.vault.process(file, (content) => {
			const lines = content.split("\n");

			const newLines = lines.map((line) => {
				const result = this.rewriteTaskLine(
					file.path,
					line,
					() => {
						stateChanged = true;
					}
				);

				if (result !== line) {
					changed = true;
				}

				return result;
			});

			return newLines.join("\n");
		});

		if (changed || stateChanged) {
			await this.savePluginData();
		}
	}

	rewriteTaskLine(
		filePath: string,
		line: string,
		markStateChanged: () => void
	): string {
		const uncheckedMatch = line.match(UNCHECKED_TASK_RE);
		const completedMatch = line.match(COMPLETED_TASK_RE);

		if (!uncheckedMatch && !completedMatch) {
			return line;
		}

		const key = this.getTaskKey(filePath, line);
		const isManaged = this.managedTaskKeys[key] === true;

		// If task is completed, remove only reminders this plugin created.
		if (completedMatch) {
			if (REMINDER_RE.test(line)) {
				if (isManaged) {
					delete this.managedTaskKeys[key];
				}

				markStateChanged();
				return this.removeReminder(line);
			}

			if (isManaged) {
				delete this.managedTaskKeys[key];
				markStateChanged();
			}

			return line;
		}

		const startMatch = line.match(START_RE);
		const dueMatch = line.match(DUE_RE);

		if (!startMatch || !dueMatch) {
			return line;
		}

		const startDate = startMatch[1];
		const dueDate = dueMatch[1];
		if (!startDate || !dueDate) {
			return line;
		}
		const reminderMatch = line.match(REMINDER_RE);

		const now = new Date();
		const nextReminder = this.computeNextReminder(
			now,
			startDate,
			dueDate
		);

		// From now on, every unfinished task with both 🛫 and 📅
		// is managed by this helper plugin until the due date.
		if (!isManaged) {
			this.managedTaskKeys[key] = true;
			markStateChanged();
		}

		// Deadline window is over. Remove helper-managed reminder and cancel tracking.
		if (!nextReminder) {
			if (this.managedTaskKeys[key]) {
				delete this.managedTaskKeys[key];
				markStateChanged();
			}

			if (reminderMatch) {
				return this.removeReminder(line);
			}

			return line;
		}

		if (!reminderMatch) {
			return this.insertReminder(
				line,
				this.formatDateTime(nextReminder)
			);
		}

		const currentReminder = this.parseReminderDateTime(line);

		// If reminder exists but cannot be parsed, replace it with the calculated one.
		if (!currentReminder) {
			return this.replaceReminder(
				line,
				this.formatDateTime(nextReminder)
			);
		}

		const graceMs = this.settings.graceMinutes * 60 * 1000;
		const reminderHasClearlyPassed =
			currentReminder.getTime() < now.getTime() - graceMs;

		// Important fix:
		// If the current ⏰ is in the past but the 📅 deadline is still in the future,
		// update ⏰ to the next valid reminder slot.
		if (reminderHasClearlyPassed) {
			return this.replaceReminder(
				line,
				this.formatDateTime(nextReminder)
			);
		}

		return line;
	}

	computeNextReminder(
		now: Date,
		startDate: string,
		dueDate: string
	): Date | null {
		const activeStartMinutes = this.timeToMinutes(
			this.settings.defaultReminderTime
		);

		const activeEndMinutes = this.timeToMinutes(
			this.settings.activeEndTime
		);

		if (activeEndMinutes < activeStartMinutes) {
			return null;
		}

		const repeatMinutes =
			Math.max(1, this.settings.repeatEveryHours) * 60;

		const start = this.dateAtMinutes(startDate, activeStartMinutes);
		const end = this.dateAtMinutes(dueDate, activeEndMinutes);

		if (end.getTime() < now.getTime()) {
			return null;
		}

		const minimumCandidate = new Date(
			Math.max(now.getTime() + 60 * 1000, start.getTime())
		);

		const day = this.startOfDay(minimumCandidate);
		const lastDay = this.startOfDay(end);

		while (day.getTime() <= lastDay.getTime()) {
			for (
				let minutes = activeStartMinutes;
				minutes <= activeEndMinutes;
				minutes += repeatMinutes
			) {
				const candidate = new Date(day);
				candidate.setHours(
					Math.floor(minutes / 60),
					minutes % 60,
					0,
					0
				);

				if (
					candidate.getTime() >= start.getTime() &&
					candidate.getTime() >= minimumCandidate.getTime() &&
					candidate.getTime() <= end.getTime()
				) {
					return candidate;
				}
			}

			day.setDate(day.getDate() + 1);
		}

		return null;
	}

	insertReminder(line: string, reminderDateTime: string): string {
		const dueMatch = line.match(DUE_RE);
		const reminderText = `⏰ ${reminderDateTime}`;

		if (!dueMatch || dueMatch.index === undefined) {
			return `${line.trimEnd()} ${reminderText}`;
		}

		const beforeDue = line.slice(0, dueMatch.index).trimEnd();
		const dueAndAfter = line.slice(dueMatch.index).trimStart();

		return `${beforeDue} ${reminderText} ${dueAndAfter}`;
	}

	replaceReminder(line: string, reminderDateTime: string): string {
		return line.replace(REMINDER_RE, `⏰ ${reminderDateTime}`);
	}

	removeReminder(line: string): string {
		return line
			.replace(REMINDER_RE, "")
			.replace(/\s{2,}/g, " ")
			.trimEnd();
	}

	parseReminderDateTime(line: string): Date | null {
		const match = line.match(REMINDER_RE);

		if (!match) {
			return null;
		}

		const date = match[1];
		const time =
			match[2] ?? this.settings.defaultReminderTime;
		if (!date) {
        return null;
    	}

		return this.dateAtMinutes(date, this.timeToMinutes(time));
	}

	getTaskKey(filePath: string, line: string): string {
		const normalizedLine = line
			.replace(REMINDER_RE, "")
			.replace(DONE_RE, "")
			.replace(/^\s*[-*]\s+\[[xX ]\]\s*/, "- [ ] ")
			.replace(/\s+/g, " ")
			.trim();

		return `${filePath}::${normalizedLine}`;
	}

	timeToMinutes(value: string): number {
		const match = value.match(/^(\d{1,2}):(\d{2})$/);

		if (!match) {
			return 9 * 60;
		}

		const hours = Number(match[1]);
		const minutes = Number(match[2]);

		return hours * 60 + minutes;
	}

	dateAtMinutes(date: string, minutes: number): Date {
		const [yearStr, monthStr, dayStr] = date.split("-");

		const year = Number(yearStr);
		const month = Number(monthStr);
		const day = Number(dayStr);
		if ([year, month, day].some((value) => Number.isNaN(value))) {
        throw new Error(`Invalid date: ${date}`);
    	}
		const result = new Date(year, month - 1, day);
		result.setHours(
			Math.floor(minutes / 60),
			minutes % 60,
			0,
			0
		);

		return result;
	}

	startOfDay(date: Date): Date {
		const result = new Date(date);
		result.setHours(0, 0, 0, 0);
		return result;
	}

	formatDateTime(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		const hours = String(date.getHours()).padStart(2, "0");
		const minutes = String(date.getMinutes()).padStart(2, "0");

		return `${year}-${month}-${day} ${hours}:${minutes}`;
	}
}

class PersistentTaskReminderSettingTab extends PluginSettingTab {
	plugin: PersistentTaskReminderPlugin;

	constructor(app: App, plugin: PersistentTaskReminderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: "Persistent Task Reminder",
		});

		new Setting(containerEl)
			.setName("First reminder time")
			.setDesc("Used on each active day, for example 09:00.")
			.addText((text) =>
				text
					.setPlaceholder("09:00")
					.setValue(this.plugin.settings.defaultReminderTime)
					.onChange(async (value) => {
						this.plugin.settings.defaultReminderTime = value;
						await this.plugin.savePluginData();
					})
			);

		new Setting(containerEl)
			.setName("Last reminder time")
			.setDesc("No reminders will be scheduled after this time.")
			.addText((text) =>
				text
					.setPlaceholder("21:00")
					.setValue(this.plugin.settings.activeEndTime)
					.onChange(async (value) => {
						this.plugin.settings.activeEndTime = value;
						await this.plugin.savePluginData();
					})
			);

		new Setting(containerEl)
			.setName("Repeat every N hours")
			.setDesc("Example: 3 means 09:00, 12:00, 15:00, etc.")
			.addText((text) =>
				text
					.setPlaceholder("3")
					.setValue(String(this.plugin.settings.repeatEveryHours))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isNaN(parsed) && parsed > 0) {
							this.plugin.settings.repeatEveryHours = parsed;
							await this.plugin.savePluginData();
						}
					})
			);

		new Setting(containerEl)
			.setName("Grace minutes")
			.setDesc(
				"Wait this long after a reminder time before updating it to the next reminder."
			)
			.addText((text) =>
				text
					.setPlaceholder("3")
					.setValue(String(this.plugin.settings.graceMinutes))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isNaN(parsed) && parsed >= 0) {
							this.plugin.settings.graceMinutes = parsed;
							await this.plugin.savePluginData();
						}
					})
			);

		new Setting(containerEl)
			.setName("Scan interval minutes")
			.setDesc(
				"How often the helper checks tasks. Reload Obsidian after changing this."
			)
			.addText((text) =>
				text
					.setPlaceholder("10")
					.setValue(
						String(this.plugin.settings.scanIntervalMinutes)
					)
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isNaN(parsed) && parsed > 0) {
							this.plugin.settings.scanIntervalMinutes =
								parsed;
							await this.plugin.savePluginData();
						}
					})
			);
	}
}