# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes —
in particular how it handles the Winix account:

- the e-mail address and password stay in the Gladys configuration; the
  password is only used for the SRP sign-in to Winix's AWS Cognito, never
  sent in clear nor written to disk;
- `/data/winix-session.json` (readable by the container user only) keeps the
  Cognito refresh token, the Cognito identity id of the account (which,
  with a device id, is enough to control a purifier through the Winix cloud),
  the list of the purifiers and a SHA-256 of the e-mail address — no
  password, no access token;
- no token, password, e-mail address or identity id may reach the logs;
- the container only talks to `cognito-idp.us-east-1.amazonaws.com`,
  `cognito-identity.us-east-1.amazonaws.com`, `us.mobile.winix-iot.com` and
  `us.api.winix-iot.com`, over HTTPS.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the Winix cloud and purifiers the integration talks to (report those to
Winix).
