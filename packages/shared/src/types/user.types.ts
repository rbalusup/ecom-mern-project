export type UserRole = 'customer' | 'admin' | 'vendor';

export interface IAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string; // ISO 3166-1 alpha-2
  isDefault?: boolean;
}

export interface IUserProfile {
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  phone?: string;
  addresses: IAddress[];
  preferences: string[]; // interest tags used for personalization
}

export interface IUser {
  id: string;
  email: string;
  cognitoId: string;
  role: UserRole;
  profile: IUserProfile;
  profileEmbedding?: number[]; // 1536-dim preference vector
  embeddingUpdatedAt?: Date;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAuthPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: Pick<IUser, 'id' | 'email' | 'role' | 'profile'>;
}
