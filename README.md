# Counterlock

Deadlock has a huge item shop, and a lot of fights come down to whether you bought the right thing against the hero in front of you. Counterlock is a small, free desktop app that takes the guessing out of that. You tell it who you're up against, and it shows you what to build, when to build it, and how to play the matchup.

**Website and downloads:** https://danielww94.github.io/counterlock-web/

## What it does

You pick the enemy hero, and if you want, the hero you're playing. Counterlock lays out the counter items for that matchup and sorts them into lane, mid, and late game, so you can see roughly when each one earns its slot. Above the items it gives you a quick read on the threat, meaning what this hero actually does to you, plus the single idea worth keeping in your head for the fight. There are also tips for the hero you're playing, and any notes on the current patch.

All of it comes out of a plain profile file, so the advice moves with the game instead of going stale. When Deadlock patches, the profile gets updated and the app just loads the new version. No reinstall, no waiting on me to push a build.

The profile it comes with is a complete one. It covers every enemy hero, and for each matchup it carries the counter items plus tips for whoever you're playing, so you get advice tuned to your own hero no matter who you pick. All of it was put together from the counter notes the community wrote.

## Getting it

Open the website and press the download button for your system, or grab the newest file from the Releases tab on this repo. There are two of them.

Windows gets a single Counterlock.exe that you just open, there's nothing to install. Linux gets a single Counterlock file that works the same way. Both carry everything they need inside, so Python and the rest don't have to be on the machine. The first time you open the Windows one, SmartScreen might warn you because the app isn't signed, so click "More info" and then "Run anyway".

## Editing the counters

Every matchup lives in a profile you can change yourself, and there are two ways in.

The first is the editor inside the settings window. It opens in its own window, so the main app can stay open right beside it. You can add or drop enemies, rewrite the threat text and the key idea, manage the item list for each stage of the game, and write tips for each hero you play. Right click a hero in the list to rename it.

The second is to open the profile file in any text editor. There's a short note at the top explaining how it's laid out, and the app picks up your changes the next time it starts. You can also point Counterlock at a completely different profile from the settings, and it remembers that choice for next time.

## Settings

There's a handful of things to tune. You can switch between a light and a dark theme. You can choose the font, one comes bundled so it looks the same everywhere, or you can fall back on your system fonts, and you can set the text size and the spacing between counter items. You can decide how heavy the item names look, and the app only offers the semibold option when the font you picked actually has one. You can also hide the key info, the tips, or the patch notes to keep the window tight. Whatever you set stays put between sessions, and the app reopens with the hero you had picked last.

Counterlock is a fan project. It isn't made by, affiliated with, or endorsed by Valve or the Deadlock team.
