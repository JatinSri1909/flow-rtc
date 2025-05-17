// src/app/page.tsx
import Link from "next/link";
import { pages } from "@/constants";

export default function Home() {
  return (
    <div className="bg-black min-h-screen flex flex-col items-center justify-center p-6">
      <h1 className="text-center text-3xl sm:text-5xl mb-5">FlowRTC</h1>
      <p className="px-5 py-3 text-center text-lg sm:text-xl text-white mb-8">
        Connect, Interact, and Engage – Live Streaming, Redefined.
      </p>
      <div className="flex flex-wrap justify-center gap-6">
        {pages.map((page, index) => (
          <div key={index} className="flex flex-col items-center gap-4 bg-black rounded-lg p-6 max-w-sm border border-white shadow-lg transition-transform transform hover:scale-105">
            <div className="text-center">
              <h2 className="text-xl text-white">{page.title}</h2>
              <p className="text-neutral-400 mb-4">{page.description}</p>
              <Link href={page.href} className="bg-white text-black px-5 py-2 rounded-md transition duration-300 hover:bg-gray-200">
                <page.icon className="inline-block mr-2" />
                {page.button}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}