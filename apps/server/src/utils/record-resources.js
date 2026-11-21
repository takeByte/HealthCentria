import mongoose from 'mongoose';
import { Announcement } from '../models/announcement.model.js';
import { Service } from '../models/service.model.js';

/**
 * The records that can take a record-level edit lock, with the permission the
 * caller needs to see or claim it. Adding a resource here (and polling it from
 * its screen) is all the generic lock route needs.
 */
export const RECORD_RESOURCES = {
  announcements: {
    label: 'announcement',
    permission: 'announcements.manage',
    exists: async (id) =>
      mongoose.isValidObjectId(id) && !!(await Announcement.exists({ _id: id })),
  },
  services: {
    label: 'service',
    permission: 'services.manage',
    exists: async (id) =>
      mongoose.isValidObjectId(id) && !!(await Service.exists({ _id: id })),
  },
};

export function recordResource(name) {
  return Object.hasOwn(RECORD_RESOURCES, name) ? RECORD_RESOURCES[name] : null;
}
