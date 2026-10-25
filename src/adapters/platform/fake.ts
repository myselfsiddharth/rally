import type { CircleId, PersonId } from '../../engine/types';
import type { Button, PlatformPort } from './port';

export interface SentDm {
  person: PersonId;
  text: string;
  buttons: Button[];
}

export class FakePlatform implements PlatformPort {
  dms: SentDm[] = [];
  posts: { circle: CircleId; text: string }[] = [];
  async dm(person: PersonId, text: string, buttons: Button[] = []): Promise<void> {
    this.dms.push({ person, text, buttons });
  }
  async post(circle: CircleId, text: string): Promise<void> {
    this.posts.push({ circle, text });
  }
  to(person: PersonId): SentDm[] {
    return this.dms.filter((d) => d.person === person);
  }
}
