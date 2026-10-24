-- Better Auth 1.7.12 SQLite schema, generated from its migration API.
create table "auth_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "auth_session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth_user" ("id") on delete cascade);

create table "auth_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "auth_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "auth_rate_limit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "auth_session_userId_idx" on "auth_session" ("userId");

create index "auth_account_userId_idx" on "auth_account" ("userId");

create index "auth_verification_identifier_idx" on "auth_verification" ("identifier");
CREATE UNIQUE INDEX auth_single_admin ON auth_user ((1));
CREATE TABLE auth_setup (id INTEGER PRIMARY KEY CHECK (id = 1), lock_id TEXT, locked_until INTEGER);
INSERT INTO auth_setup (id) VALUES (1);
CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK (id = 1), config_json TEXT NOT NULL DEFAULT '{}', resend_cipher TEXT, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
INSERT INTO app_settings (id) VALUES (1);
