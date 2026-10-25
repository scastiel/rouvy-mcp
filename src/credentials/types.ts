/** What we keep to reopen a Session without the password. */
export interface Credentials {
  refreshToken: string;
  uid: string;
  email?: string;
}

/** Where Credentials live. The server core only ever sees this interface. */
export interface CredentialsProvider {
  load(): Promise<Credentials | null>;
  save(credentials: Credentials): Promise<void>;
}
