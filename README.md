# LinkedIn Auto-Apply Bot (LAA)

LAA is a robust, autonomous, and config-driven automation tool designed to apply for matching LinkedIn jobs. Built with **Playwright**, **Node.js**, and **Nodemailer**, it operates locally in headful (visual) mode using session cookies to completely bypass manual credential storage or API restrictions.

---

## Key Features

1. **Intelligent Keyword Filtering:**
   - **Skip Exclusions:** Auto-skips roles containing unwanted keywords such as `tester`, `testing`, `wordpress`, `sap`, or `qa`.
   - **Core Skill Alignment:** Only applies if the job title contains core skills or matching roles defined in your profile configuration (e.g. `Node.js`, `Angular`, `Fullstack`, `Backend`, `SDE`).
2. **Visual Interaction (Headful Mode):**
   - Launches a visible browser window so you can watch the bot navigate pages, read listings, and fill out forms in real-time.
3. **Robust Background Scheduler:**
   - Runs continuously and schedules runs at randomized times:
     - **Morning Run:** Triggers randomly between **11:00 AM and 12:00 PM**.
     - **Evening Run:** Triggers randomly between **4:00 PM and 5:00 PM**.
   - **Randomized Split Limits:** Randomly splits the daily cap of **40 applications** between the two runs (e.g., 18 in the morning, 22 in the evening; or 17 in the morning, 23 in the evening).
4. **Nightly Email Reports:**
   - Dispatches a single consolidated daily Excel/CSV report at exactly **11:00 PM (23:00)** listing all applied jobs for that day.
5. **Smart Question Guesser & Memory:**
   - Automatically answers standard forms (experience years, salary expectations, notice periods, locations).
   - Learns and remembers answers: if it encounters a new question, it prompts you in the terminal, saves your response to `answers.json`, and never asks again.
6. **Safe Handling of Expired Jobs:**
   - Detects and instantly skips listings with disabled "Easy Apply" buttons without causing Playwright timeouts.

---

## Technical Architecture

```
LAA/
├── config/
│   ├── profile.json            # Active profile & skills (Git-ignored)
│   ├── profile.example.json    # Profile template for GitHub
│   ├── email.json              # Active SMTP credentials (Git-ignored)
│   ├── email.example.json      # SMTP template for GitHub
│   ├── answers.json            # Memory of screening questions (Git-ignored)
│   └── answers.example.json    # Example answers template
├── resume/
│   └── Aditya_Resume.pdf       # Place your PDF resume here (Git-ignored)
├── session/
│   └── storageState.json       # Active session cookies (Git-ignored)
├── logs/
│   ├── applied_jobs.json       # Persistent database of application history
│   └── run_YYYY-MM-DD.log      # Debug logs
├── excel/
│   └── applied_jobs_YYYY-MM-DD.csv # Consolidated daily spreadsheet reports
├── src/
│   ├── main.js                 # Core orchestrator and scraper
│   ├── scheduler.js            # Background runner and notification timer
│   ├── email.js                # SMTP email dispatcher
│   ├── tracker.js              # CSV generator & daily cap manager
│   ├── login.js                # One-time interactive session recorder
│   └── logger.js               # Colored console output logger
├── .gitignore                  # Security list keeping credentials private
├── package.json                # Project dependencies
└── README.md                   # Setup guide
```

---

## Setup & Installation

### 1. Prerequisite Checklist
Make sure you have [Node.js](https://nodejs.org/) installed (v16 or higher).

### 2. Clone the Repository
```bash
git clone https://github.com/yourusername/LAA.git
cd LAA
```

### 3. Install Dependencies
```bash
npm install
npx playwright install chromium
```

### 4. Configure Your Files
Since personal data and credentials are kept safe inside `.gitignore`, you need to copy the template files and fill in your details:

```bash
# Copy template files
cp config/profile.example.json config/profile.json
cp config/email.example.json config/email.json
cp config/answers.example.json config/answers.json
```

- **`config/profile.json`:** Add your name, target role titles, core skills, location, and specify the file name of your resume.
- **`config/email.json`:** Enter your Gmail address and a [Google App Password](https://support.google.com/accounts/answer/185833?hl=en) to enable SMTP email notifications.
- **`config/answers.json`:** Pre-seed answers to common application screening questions.

### 5. Add Your Resume
Place your resume PDF in the `resume/` directory and make sure the file name matches `resume_file_path` inside `config/profile.json`.

---

## Run Commands

### Step 1: One-Time Session Authentication
Authenticate the bot on your LinkedIn account. This saves session cookies locally so the bot doesn't need your password:
```bash
npm run login
```
*A browser opens. Manually log in to your LinkedIn account. Once you see your home feed, close the browser window. The credentials state is saved to `session/storageState.json`.*

### Step 2: Run the Bot Manually
To execute a single run immediately to verify setup:
```bash
npm start
```

### Step 3: Run the Scheduler in the Background
To run the set-and-forget daemon that operates automatically throughout the day:
```bash
npm run scheduler
```
*The scheduler checks time in the background. It will automatically trigger runs at the random morning and evening times, and send you the CSV report email at 11:00 PM.*

---

## How It Works

### The Dynamic Schedule Logic
- Every midnight, the scheduler resets:
  1. Generates a random daily target limit between **44 and 50** (e.g., `46`).
  2. Generates a random morning target $M$ between **15 and 25** (e.g., `19`).
  3. Sets the evening target to the remainder (e.g., `46 - 19 = 27`).
  4. Schedules a random morning check time between **11:00 AM and 11:59 AM**.
  5. Schedules a random evening check time between **4:00 PM and 4:59 PM**.
  6. Schedules the email report dispatch for exactly **11:00 PM**.

### Keyword Inclusions and Exclusions
The bot scans the job title in the right pane of the search list:
1. **Case-Insensitive Skip Check:** If the title contains `tester`, `testing`, `wordpress`, `qa`, or `sap` (checked with regex word boundaries), the bot logs `[Skip] Excluded role type` and moves to the next card.
2. **Title Alignment Check:** The bot verifies if the title contains at least one target skill or role from your `profile.json` (such as `fullstack`, `backend`, `node`, `angular`, `sde`, etc.). If there is no overlap, it skips the job to avoid applying to mismatched roles.

---

## Security Best Practices
- **No Password Exposure:** The bot never asks for, stores, or transmits your passwords.
- **Strict Git Ignore rules:** `.gitignore` blocks the commit of `profile.json`, `email.json` (credentials), `answers.json` (personal details), `session/storageState.json` (account sessions), and `excel/` (application reports).
- **Rate-Limited Actions:** Random delays of **5 to 15 seconds** occur between individual applications to mimic human browsing behavior and protect your LinkedIn account from spam flags.
