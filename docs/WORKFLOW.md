# Business workflow (as built)

## Lead → deal → quote → Finance → won
1. **Lead** is created by Super Admin / CSO / Sales Executive. Sales Executives see only their own leads.
2. **Deal** is created from the lead (or client): value, **any ISO currency**, stage, expected close. Stages carry a probability used for the weighted forecast.
3. When the client agrees a price, the owner creates a **Quote** on the deal: customer, project details, delivery date, line items, tax, payment terms / upfront proposal. Submitting sends it to Finance and moves the deal to *Proposal sent*.
4. **Finance reviews.** Either:
   - **Return** with a reason. Sales fixes and resubmits; or
   - **Approve**, deciding whether an upfront payment is needed (none / % / fixed amount) and the due date. Approval, in one transaction: creates the client from the lead if needed, issues the **invoice**, marks the quote approved, and marks the deal **Won** (stamped with Finance's name and time). Sales owner and Project Managers are notified.
5. The sales owner opens the quote / invoice (Print → Save as PDF) and gives them to the client.
6. **Won is reserved for Finance.** Nobody can drag a deal into Won, and a won deal cannot be dragged out. Enforced by a database trigger, not just the UI.
7. Money: an invoice is **not** revenue received. Payments are recorded separately; balances, partial payments, upfront-received and overdue are derived. Overpayment is rejected.

## If the client backs out
- Finance deletes the invoice (payments only with explicit confirmation). The deal is **reopened in Negotiation**, the quote is cancelled, the owner is notified, and it is audited. The user can send a new quote later and win the deal again, or delete the deal / lead.
- **Deletes** (all confirmed, audited where financial): leads, clients, deals, quotes (draft/returned), follow-ups, tasks, projects, invoices, payments. Blocking rules protect history: a client with invoices/projects, or a deal with an invoice, must have those removed first, with a clear message.

## Currencies, targets and rates
- Every deal, quote and invoice has its own currency. Dashboards and reports convert to **USD and PKR** (toggle).
- At month end Super Admin / CSO enter **1 unit = USD / PKR** per currency under *Targets & rates*. Currencies with deals won that month are listed automatically. A deal is converted with the rate of the month it was won; with no rate for that month the latest earlier rate is used and flagged *estimated*; with none, it is excluded and flagged *rate needed*. Nothing is guessed.
- Super Admin / CSO set a **monthly target per Sales Executive** in USD and/or PKR. A month with no new target **carries the previous one forward**. Progress is checked in both USD and PKR.

## Who sees what
| | Leads / deals / quotes | Invoices & payments | Targets | Rates | Projects & tasks |
|---|---|---|---|---|---|
| Super Admin | all | all | assign | enter | all |
| CSO | all | invoices of any deal | assign | enter | read projects |
| Sales Executive | own | invoices/payments of own won deals | own | read | none |
| Finance | submitted quotes only (no leads/deals) | all, manage | none | read | read projects |
| Project Manager | none | none | none | read | manage |
| Team Lead / Developer | none | none | none | read | own / assigned |

## Messaging (who may START a chat; anyone may reply)
Super Admin → everyone · CSO → Sales, Finance, PM · Sales → CSO, PM · PM → Super Admin, CSO, Developers · Finance → Super Admin, CSO.
**Assumption:** Team Lead ↔ Project Manager and Developers (you did not list Team Lead). Change `app.can_message` if you want otherwise.
