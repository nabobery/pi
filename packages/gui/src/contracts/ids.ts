import { Schema } from "effect";

const NonEmptyId = Schema.String.pipe(Schema.minLength(1));

export const WorkspaceId = NonEmptyId.pipe(Schema.brand("@PiGui/WorkspaceId"));
export type WorkspaceId = Schema.Schema.Type<typeof WorkspaceId>;

export const SessionId = NonEmptyId.pipe(Schema.brand("@PiGui/SessionId"));
export type SessionId = Schema.Schema.Type<typeof SessionId>;

export const RunId = NonEmptyId.pipe(Schema.brand("@PiGui/RunId"));
export type RunId = Schema.Schema.Type<typeof RunId>;

export const RequestId = NonEmptyId.pipe(Schema.brand("@PiGui/RequestId"));
export type RequestId = Schema.Schema.Type<typeof RequestId>;

export const EventId = NonEmptyId.pipe(Schema.brand("@PiGui/EventId"));
export type EventId = Schema.Schema.Type<typeof EventId>;

export const CatalogRevision = NonEmptyId.pipe(Schema.brand("@PiGui/CatalogRevision"));
export type CatalogRevision = Schema.Schema.Type<typeof CatalogRevision>;

export const ExtensionUiRequestId = NonEmptyId.pipe(Schema.brand("@PiGui/ExtensionUiRequestId"));
export type ExtensionUiRequestId = Schema.Schema.Type<typeof ExtensionUiRequestId>;

export const workspaceIdFromString = WorkspaceId.make;
export const sessionIdFromString = SessionId.make;
export const runIdFromString = RunId.make;
export const requestIdFromString = RequestId.make;
export const eventIdFromString = EventId.make;
export const catalogRevisionFromString = CatalogRevision.make;
export const extensionUiRequestIdFromString = ExtensionUiRequestId.make;
