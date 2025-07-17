Design a fully functional and scalable front-end dashboard for BabuMoto's AI-integrated WhatsApp System.

The dashboard should replicate the WhatsApp layout and user experience, with the following detailed modules and specifications. The system is intended for AI-powered customer support, monitoring, and administration.

🔐 1. Login Page
Minimalistic and mobile-responsive.

Fields:

Username or Email

Password

Action Button:

Login

Optional:

“Forgot Password?” link

💬 2. Chat Page (WhatsApp-Style Messaging Interface)
Replicate WhatsApp layout:

Left Sidebar:

Recent Chats with Contact Name, Last Message Preview, Timestamp

Right Chat Window:

Full chat history with time-stamps

Message Composer Features:

Text Input

📎 Attachments (Image, Video, Audio, Document – open file picker)

🎤 Voice Recording

📍 Location Picker (in popup modal) – Choose current location or search via Google Maps

👤 Contact Selector – Opens pop-up to select from stored contact list

Message Metadata: Show time, sender, delivery status

❓ 3. Question & Answer Center
➤ Sub-Page: All Q&A History
Table View:

Columns: Question, AI Response, Customer Name, Phone Number, Timestamp

Filters: Date, Customer, Tags, Keywords

➤ Sub-Page: Unanswered Questions
Table View:

Question, Customer Name, Phone Number, Time

Actions:

Export: .csv, .pdf, Copy

Mark as resolved or assign to human

Add Tags (dropdown with editable tag options)

📚 4. Knowledge Base Manager
Add New Knowledge Base Entry:

Fields: Title, Content (Rich Text or Markdown)

Drag & Drop File Upload:

Accept: .txt, .md

Table of Entries:

Columns: Title, Status (Enable/Disable), Actions (View, Download, Delete)

add page to edit the knowledgbase content should have a big textarea to edit the knowlegebase also edit the title of the knnowledge base 

Ability to toggle knowledge base visibility per customer type (e.g. DTO clients vs new inquiries)

📇 5. Contact Tracker
Table View:

Customer Name, Phone Number, Status, #Messages, Last Message Date

Click to expand full message history

make all forms and buttons work

Action Dialog:

Update status

Add/Edit Tags (e.g. DTO, Technical, New Inquiry, Payment Follow-up)

Bulk Actions:

Multi-select contacts to tag, change status, or export

📈 6. Analytics Dashboard
Real-time graphs and summaries:

Total Inquiries

Answered Questions

Unanswered Questions

Daily/Weekly/Monthly Activity

AI Token Consumption

Filters:

Date Range, Tags, Status

Graph Types: Bar, Pie, Line

KPI cards (e.g. Avg Response Time, Total Messages Today, AI Accuracy)

🧾 7. Reporting Module
Generate customizable reports:

Filter by date range, tags, response quality, user types

Export Options:

.csv, .pdf, .docx

💵 8. Billing & Usage Tracker
Monitor:

💬 WhatsApp message cost (utility, promo, authentication)

🧠 OpenAI/GPT token usage (e.g. cost per million tokens)

Admin can:

Set token & messaging rates

Track usage per month

Track usage per client (if third-party clients are integrated)

🧠 9. AI Performance Logs
Table:

Prompt, AI Reply, Status (Success/Fail), Tokens Used, Response Time

Tag if the AI:

Answered well

Was inaccurate

Missed the context

Use for fine-tuning knowledge base and prompt optimization

🔁 10. Conversation Reassignment
Admins can:

Forward or assign an unanswered query to a human support agent

Track who took over which conversation

🏷️ 11. Tag Manager
Interface to:

Create, edit, delete reusable tags

Assign color codes to tags

Group tags by type (inquiry, status, feedback, etc.)

📤 12. Bulk Messaging Panel
Option to send a single message to multiple users

Upload list via CSV

Attach files, set tags, schedule delivery

🔧 13. Settings Panel (Multi-Tab)
Tab 1: App Settings
App Name

Theme Colors

Enable/Disable Modules (e.g. About Us, Billing)

Tab 2: AI Prompt Settings
System Prompt (Main Instruction)

Greeting Message

Fallback Message

Tab 3: AI Tools
Define callable external APIs for AI

Add input/output examples

Tab 4: Customer Routing Logic
Define how AI should respond based on user type:

Existing DTO Clients

New Inquiries

Split knowledge base or prompt flow

Tab 5: Integration Access
Connect to external apps (e.g. BabuMoto CRM or DTO software)

Webhook endpoints

Tab 6: Knowledge Base Division
Upload separate files for:

New Users

Existing DTO Clients

Tab 7: Profile Settings
Change password

Update profile photo

Enable 2FA (optional)

Tab 8: About Us Page Toggle
Editable content

Enable/Disable visibility for external access

👥 14. User Management
Add/Edit/Delete Users

Roles: Admin, Agent, Manager, Developer

Set page/module access permissions

Audit Log:

Track all user actions (login, file upload, deletion, knowledge edits)

📢 15. Notifications
Real-time alerts for:

Unanswered questions after X mins

Failed API calls

Channels:

In-app, WhatsApp, Email

📦 16. Storage Management
Monitor total upload size for:

Chat Attachments

Knowledge Base Files

Set upload limits and alerts

🧪 17. AI Test Lab (Sandbox Mode)
Ask test questions

View AI response and token usage

Used for safe testing without logging real user data

🔐 18. Security Features
Session timeout settings

Admin control over IP whitelisting (optional)

Role-based access controls

End-to-end encryption for chat content

Important Development Notes for AI:

Replicate WhatsApp layout exactly: layout, spacing, simplicity

Ensure responsiveness on mobile, tablet, and desktop

Use clean, modern UI (Tailwind CSS or similar)

Prepare for future multi-tenant support (if needed)

Use component-based structure for modular growth