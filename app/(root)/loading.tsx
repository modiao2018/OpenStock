import { Loader2 } from 'lucide-react';

// Instant navigation feedback: shown the moment a nav link is clicked,
// while the target page's server render is still fetching data.
export default function Loading() {
    return (
        <div className="flex min-h-[60vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
        </div>
    );
}
