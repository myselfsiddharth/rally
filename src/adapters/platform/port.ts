import type { CircleId, PersonId } from '../../engine/types';

export interface Button {
  id: string;
  label: string;
  style?: 'primary' | 'secondary' | 'danger';
}

/** Where agents talk to their students: a direct message, or the friend circle's channel. */
export interface PlatformPort {
  dm(person: PersonId, text: string, buttons?: Button[]): Promise<void>;
  post(circle: CircleId, text: string): Promise<void>;
}
