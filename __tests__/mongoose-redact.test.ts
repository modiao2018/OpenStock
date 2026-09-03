import { describe, expect, it } from 'vitest';
import { redactMongoUri } from '@/database/mongoose';

describe('redactMongoUri', () => {
    it('hides user:password but keeps host and database', () => {
        expect(redactMongoUri('mongodb://root:s3cr3t@mongodb:27017/openstock?authSource=admin'))
            .toBe('mongodb://***@mongodb:27017/openstock?authSource=admin');
        expect(redactMongoUri('mongodb+srv://u:p%40ss@cluster0.x.mongodb.net/db'))
            .toBe('mongodb+srv://***@cluster0.x.mongodb.net/db');
    });
    it('leaves credential-less URIs alone', () => {
        expect(redactMongoUri('mongodb://localhost:27017/openstock')).toBe('mongodb://localhost:27017/openstock');
    });
});
