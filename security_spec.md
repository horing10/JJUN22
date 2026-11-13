# Security Specification — Shared Team Workspaces (PhotoAtlas)

## 1. Data Invariants
1. All reads and writes require a verified signed-in user (`request.auth != null && request.auth.token.email_verified == true`).
2. Default-deny catch-all rule (`match /{document=**} { allow read, write: if false; }`) blocks all unspecified paths.
3. No workspace enumeration (`allow list: if false` on `/workspaces`); users can only read `/workspaces/{workspaceId}` by exact workspace ID or list their own `/users/{userId}/workspaces`.
4. Only members with an active `/workspaces/{workspaceId}/members/{request.auth.uid}` document may read or write `sections`, `photos`, `photoMedia`, or `workEntries` inside that workspace.
5. Joining a workspace (`/workspaces/{workspaceId}/members/{memberId}`) enforces `memberId == request.auth.uid`, `uid == request.auth.uid`, and forbids self-assigning `role: 'owner'` unless the user is already the workspace `ownerId` (`get` / `getAfter` atomic creation).
6. Zero PII (`email`, `phone`) is stored in shared `/workspaces/{workspaceId}/...` documents; only non-PII `displayName` / `uploadedByName` labels are shared.
7. Every document ID passes `isValidId()` (`^[a-zA-Z0-9_\-]+$`, 1..128 chars), every string enforces `.size()` limits, `photoMedia.dataUrl` is strictly bounded (`<= 750000`), and all server timestamps (`createdAt` / `updatedAt` / `joinedAt`) must equal `request.time`.
8. Updates enforce `isValid[Entity](incoming())`, preserve immutable ownership/creation fields (`ownerId`, `createdBy`, `uploadedBy`, `createdAt`), and constrain `affectedKeys().hasOnly(...)`.

## 2. "Dirty Dozen" Adversarial Payloads
1. Unauthenticated read/write to `/workspaces/ws1/photos/p1` -> `PERMISSION_DENIED`.
2. Unverified email user (`email_verified: false`) writing `/workspaces/ws1` -> `PERMISSION_DENIED`.
3. Non-member querying `/workspaces` (`allow list`) -> `PERMISSION_DENIED`.
4. Non-member reading `/workspaces/ws1/photos/p1` -> `PERMISSION_DENIED`.
5. Member attempting self-privilege escalation (`role: 'owner'`) when joining `/workspaces/ws1/members/uid2` -> `PERMISSION_DENIED`.
6. Shadow field injection (`isAdmin: true` or `extraField: 1`) in `photos` create/update -> `PERMISSION_DENIED`.
7. Oversized `id` (`"a".repeat(500)`) or invalid characters (`"../bad"`) -> `PERMISSION_DENIED`.
8. Identity spoofing (`uploadedBy: "other_uid"`) when creating `SharedPhoto` -> `PERMISSION_DENIED`.
9. Timestamp spoofing (`updatedAt: backdatedTime`) -> `PERMISSION_DENIED`.
10. Oversized `photoMedia.dataUrl` (`> 750000` bytes) -> `PERMISSION_DENIED`.
11. Mutating immutable `uploadedBy` or `id` on `SharedPhoto` update -> `PERMISSION_DENIED`.
12. Accessing another user's `/users/otherUid/workspaces/ws1` -> `PERMISSION_DENIED`.
