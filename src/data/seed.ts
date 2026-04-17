export interface Operation {
  id: number;
  timestamp: Date;
  skillId: string;
  skillName: string;
  platform: string;
  deviceId: string;
  accountId: string;
  operator: string;
  status: 'success' | 'fail' | 'cancel';
  durationSec: number;
  creditsCost: number;
  comments: number;
  likes: number;
  saves: number;
  dms: number;
  reach: number;
  keyword: string;
}

export interface Member {
  id: number;
  name: string;
  phone: string;
  role: string;
  joinDate: string;
}

export var operations: Operation[] = [];
export var MEMBERS_SEED: Member[] = [];
