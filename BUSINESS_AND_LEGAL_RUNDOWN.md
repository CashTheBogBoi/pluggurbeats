# PluggurBeats Business and Legal Rundown

This is a founder-level planning document, not legal advice. Before launch at scale, have an attorney review the terms, privacy language, music rights language, refund policy, and email compliance.

## Product Summary

PluggurBeats is becoming a two-sided music marketplace plus workflow platform.

On one side, producers upload beats, loops, and campaigns. On the other side, verified producers, artists, and A&Rs browse, request, stream, download, export, and respond to those submissions. Staff sits in the middle to moderate quality, manage verification, protect contact info, and control the review pipeline.

## Main User Types

### Paid Customer Tiers

- Free
- Plugg
- Pro

These control what a customer can submit to and how much access they have.

### Verified Profile Roles

- Producer
- Producer+
- Producer++
- Artist
- Artist+
- Artist++
- A&R
- A&R+
- A&R++

These describe verified identity/status in the marketplace. They are separate from paid subscription tiers.

### Staff/Admin

Staff users can moderate campaigns, manage credits, verify users, assign roles, manage rush queue priority, review submissions, and protect platform quality.

## Current Feature Set

### Authentication and Profiles

- Email/password account system.
- Profile names and avatars.
- Instagram/profile metadata.
- Verified access flags.
- Staff-only controls for role and access management.
- A&R label name support.
- Private contact info is not exposed in public request cards.

### Producer Campaigns

- Producers can start campaigns from the dashboard.
- Campaigns include beat uploads, metadata, tags, collaborators, and add-ons.
- Beats are stored in UUID-based Firebase Storage folders.
- Beat files are restricted to `.mp3`.
- Staff reviews campaigns before they become visible or pitched.
- Approved beats can enter the Verified library.
- Rush queue costs extra credits.
- Rush and age-based review priority exists for staff workflow.

### Credits and Billing

- Paid plans use pitch credits and loop credits.
- Credit packs can be purchased.
- Rush queue uses extra credits.
- Stripe handles checkout and billing.
- Credits are debited server-side, not trusted from the client.

### Verified Library

- Verified users can browse approved beats and live loops.
- Audio previews are lazy-loaded for better performance.
- Beats are paginated and loaded efficiently.
- Download/export flows are designed for web and iOS.
- iOS uses native share/export behavior where possible.
- Pro beats are prioritized in the Verified library randomization logic.

### Request Marketplace

- Verified users can create campaign/loop requests.
- Producers can only request loops.
- Artists and A&Rs can request beats, loops, or both.
- Request cards show profile picture, public name, role, label name if applicable, title, brief, genres, tags, references, and deadline.
- Contact info is not visible.
- Users can submit campaigns or loops directly to requests.
- Submission access is role and plan gated:
  - Free can submit only to Producer requests.
  - Plugg can submit to Producer, Producer+, Artist, Artist+, and A&R requests.
  - Pro can submit to every verified role tier.
- Request submission counts are tracked.

### Staff Board

- Campaign moderation.
- Rush queue and time-sensitive review handling.
- 72-hour review guarantee logic:
  - Pending campaigns over 48 hours become priority.
  - Rush campaigns over 24 hours become priority.
- Staff navigation back to Dashboard and Verified.
- User management, roles, verification, credits, and bans.

### Mobile/iOS

- Capacitor iOS project is synced with the built web app.
- Native export/share support is integrated.
- Mobile layout and modal behavior have been optimized for Dashboard, Verified, Staff, and campaign submission flows.

## Business Model

### Current Revenue Streams

- Monthly Plugg subscription.
- Monthly Pro subscription.
- Pitch credit packs.
- Loop credit packs.
- Rush queue add-on.

### Potential Future Revenue Streams

- Premium request boosts.
- A&R request sponsorship.
- Verified profile upgrades.
- Advanced campaign analytics.
- Higher-tier Pro inbox/email access.
- Marketplace commission if formal beat licenses are sold through the platform.
- Enterprise/label dashboards.

## Key Business Risks

### Music Rights

This is the biggest legal risk. Users upload copyrighted audio, and other users can stream, download, export, or act on it.

The platform needs very clear language around:

- Who owns the uploaded beat or loop.
- Whether samples are cleared.
- Whether collaborators approved the upload.
- What rights PluggurBeats gets to host, stream, transmit, email, preview, and make the file available.
- What a verified user is allowed to do after downloading.
- Whether downloads are evaluation-only or include a license.
- Whether commercial release rights are handled inside or outside the platform.

### Download Meaning

The product currently feels like discovery, pitching, and evaluation, not a full beat-license checkout system.

That distinction should be explicit:

- A download/export should not automatically mean commercial release rights unless the terms say so.
- Verified users should not be allowed to resell, redistribute, claim ownership, upload to Content ID, or commercially release without a separate license.
- Producers should remain responsible for their uploaded content.

### Private Contact Protection

A&R and artist contact info should stay server-side.

The product should never expose:

- Raw emails.
- Phone numbers.
- Private contact lists.
- Internal desk/contact mappings.

### Outbound Email

If Pro submissions email A&Rs or other industry contacts, commercial email rules matter.

The platform should support:

- truthful sender information
- non-deceptive subject lines
- opt-out/unsubscribe handling
- suppression lists
- compliant business address handling
- logs for delivery, opens, clicks, and unsubscribes

## Documents the Business Needs

### Terms of Service

Should cover:

- account rules
- subscriptions
- credits
- refunds
- uploads
- campaign review
- Verified library access
- request marketplace behavior
- staff moderation
- bans and account termination
- acceptable use
- limitation of liability
- arbitration/class action language if desired
- no guarantee of placements, sales, replies, streams, or industry results

### Privacy Policy

Should cover:

- account data
- profile data
- uploaded files
- payment metadata
- analytics
- email events
- contact/private marketplace data
- how data is used
- who data is shared with
- data retention
- deletion requests
- cookies/tracking
- security practices

### Upload / Creator Agreement

Producers should agree that:

- they own or control everything they upload
- they have rights to all samples, loops, vocals, and collaborations
- uploaded content does not infringe third-party rights
- PluggurBeats can host, store, stream, preview, transmit, pitch, email, and make downloads available as needed for the service
- they are responsible for disputes related to their content
- PluggurBeats can remove content if there is a rights complaint or policy issue

### Verified User / Download Terms

Verified users should agree that:

- downloads are for evaluation/review unless a separate license exists
- they cannot resell or redistribute files
- they cannot claim ownership of files
- they cannot use Content ID against uploaders
- they cannot commercially release music using downloaded beats/loops without a proper license
- abuse can result in removal of access

### Refund and Credit Policy

Should define:

- whether subscriptions are refundable
- whether credit packs are refundable
- whether credits expire
- whether monthly credits roll over
- what happens after cancellation
- what happens if a campaign is rejected
- whether rush fees are refundable if the campaign is rejected or delayed

### DMCA / Copyright Policy

The site should have a takedown process for copyright complaints.

Needed pieces:

- public copyright complaint email/process
- designated DMCA agent if the business wants DMCA safe-harbor protections
- repeat infringer policy
- counter-notification process
- staff workflow to remove disputed beats/loops/campaigns

### Acceptable Use Policy

Should prohibit:

- stolen beats
- uncleared samples presented as cleared
- fake A&R/label identities
- impersonation
- spam
- harassment
- scraping
- bot downloads
- malware
- attempts to expose private contacts
- fraudulent credit/payment behavior

### Email Policy

Should cover:

- outbound campaign emails
- unsubscribe handling
- contact suppression
- bounce handling
- no deceptive campaign content
- no spammy submissions

## LLC and Company Setup

Strongly consider forming an LLC before serious scale.

Practical setup:

- Form an LLC.
- Get an EIN from the IRS.
- Open a business bank account.
- Move Stripe to the business entity.
- Use business accounting software.
- Track revenue by subscriptions, credits, add-ons, and refunds.
- Get a business mailing address.
- Consider media liability, cyber, and general business insurance.
- Keep personal and business finances separate.

## Operational Controls to Add

### Before Public Scale

- Final Terms of Service.
- Final Privacy Policy.
- Upload rights checkbox.
- Campaign submission terms checkbox.
- DMCA page.
- Refund policy.
- A clear explanation of what download/export does and does not permit.
- Opt-out handling for emails.
- Staff audit logs.
- Takedown workflow.
- Report abuse button for beats, loops, users, and requests.

### Soon After

- Request owner controls:
  - edit
  - close
  - archive
- Staff moderation for requests:
  - pending
  - open
  - rejected
  - closed
- Request analytics:
  - request views
  - submission count
  - approved submissions
  - email delivery
  - email opens/clicks
  - conversion from view to submission
- Public verified profile pages without contact info.
- Better role filters and upgrade messaging.
- Separate actions for `both` requests:
  - Submit campaign
  - Submit loop

## Suggested Positioning

PluggurBeats should present itself as:

> A curated beat and loop pitching platform where producers submit music into a verified network of artists, A&Rs, and creators, with staff review, private contact protection, request-driven submissions, and campaign analytics.

Avoid promising:

- guaranteed placements
- guaranteed replies
- guaranteed label attention
- guaranteed income
- guaranteed streams

Better promises:

- organized delivery
- verified access
- quality control
- faster review workflows
- better targeting
- cleaner request matching
- private contact protection

## Source References

- SBA business structure overview: https://www.sba.gov/business-guide/launch-your-business/choose-business-structure
- IRS LLC tax classification: https://www.irs.gov/businesses/small-businesses-self-employed/limited-liability-company-llc
- FTC privacy and security guidance: https://www.ftc.gov/business-guidance/privacy-security
- FTC CAN-SPAM Rule: https://www.ftc.gov/legal-library/browse/rules/can-spam-rule
- U.S. Copyright Office DMCA designated agent directory: https://www.copyright.gov/dmca-directory/

