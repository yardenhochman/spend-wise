# Official Leumi mortgage documents

Run these commands from the SpendWise directory. Authentication uses the same
local Leumi credentials as financial refresh; private files must not be committed.

```bash
# Discover the bank's self-service mortgage document catalogue.
mise exec -- npm run docs:leumi -- --list

# Request the detailed balance/early-repayment report (דוח יתרות לסילוק).
mise exec -- npm run docs:leumi -- --request repayment-information

# Request the shorter balance-to-clear certificate instead.
mise exec -- npm run docs:leumi -- --request clearing-balance

# Collect available mortgage PDFs from the last 30 days of the bank mailbox.
mise exec -- npm run docs:leumi -- --collect

# Request and check every five minutes for up to two hours.
mise exec -- npm run docs:leumi -- --request repayment-information --watch
```

Leumi's current workflow generates these reports asynchronously. Its confirmation
says they arrive in **תיבת הדואר שלי within about an hour**. A successful order
means `pending`, not that a PDF has been downloaded. The report requested through
the verified grouped mortgage selection covers the mortgages in that group.
If more than one group is offered, the command stops before submitting.

The command discovers all seven self-service report types currently offered by
the bank, but generation is implemented only for the two repayment reports above.
Other mortgage PDFs already in the mailbox can be collected. It does not place
repayment orders, generate a local substitute report, or send documents elsewhere.
Opening a bank-mail document can mark it read in Leumi's mailbox.

## Finding downloaded documents

`private/leumi-documents/index.json` records original bank titles, mailbox sent
dates, retrieval timestamps, SHA-256 hashes, and PDF filenames. The sent date is
not asserted to be the balances' effective date; inspect the report before relying
on it. `requests[].documents` identifies PDFs matched to each request.

Each original PDF is saved as `<sha256>.pdf` in that directory. Identical files
are deduplicated. HTML/PDF-viewer wrappers and truncated PDFs are rejected.
Old reports and files present before an order do not satisfy the new request.
Existing documents remain available if a refresh fails.

Order intent is saved **before** the bank confirmation click. `submitting` or
`uncertain` means the bank may have accepted the order; the crawler will collect
mail but will not submit a duplicate automatically. Inspect the bank confirmation
or mailbox before resolving such an order manually. A corrupted index also fails
closed. A `.lock/pid` file prevents concurrent document commands; after a crash,
check that PID before removing the stale lock directory.

## Background collection on Linux

For a pending request, start a temporary user service that checks every five
minutes for up to two hours and shows a desktop notification on completion:

```bash
systemd-run --user --collect --unit=spendwise-leumi-documents \
  --property=WorkingDirectory="$PWD" \
  "$PWD/scripts/collect-leumi-documents.sh"
```

Check it with `systemctl --user status spendwise-leumi-documents.service`.
This one-off service does not survive a reboot. After a timeout or reboot,
rerun `--collect --watch`; it keeps the existing order and does not create another.
Financial data refresh remains a separate command.
