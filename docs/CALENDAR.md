# Project calendar and agenda

The calendar reads the current project's saved cards and agent sessions. A planned date is a plan, not proof of completion. A completion appears only after someone explicitly marks the card complete. Moving a card to a Done column does not create a completion event.

The agenda below the month grid switches between the current month and a selected day. It shows planned card dates, explicit completions, and observed starts and ends of agent sessions. Selecting a day opens that day's agenda; selecting a card title opens its card. Long agendas use 20 entries per page.

Agent events use the stored session timestamps and agent name. An exit code of zero is reported as a finished run; a failure or stop is labeled accordingly. If the result cannot be established, the agenda says so. It never estimates a percentage, says that a card is finished because an agent ran, or creates future dates for an agent session. The month grid counts session starts once per run, even when a run also ends that day.

Times are shown in the device's local timezone. Planned card dates are stored as calendar days; if a card's date changes, the current plan appears on the new day and its edit history remains in the card. The agenda is a local project view, not a shared team calendar or scheduled worker queue.
