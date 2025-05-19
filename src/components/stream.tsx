"use client"

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const SIGNALING_URL = "http://localhost:4000";
const ROOM_ID = "main-room";

export const Stream = () => {
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState<string>("");
    const [connected, setConnected] = useState(false);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        let socket: Socket;
        let pc: RTCPeerConnection;
        let localStream: MediaStream;
        let remoteStream: MediaStream;
        let remoteSocketId: string | null = null;
        let shouldCreateOffer = false;

        const getMediaAndConnect = async () => {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localStreamRef.current = localStream;
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = localStream;
                }

                // Connect to signaling server
                socket = io(SIGNALING_URL);
                socketRef.current = socket;

                socket.on("connect", () => {
                    setConnected(true);
                    socket.emit("join", ROOM_ID);
                });

                // Receive user count to determine offerer/answerer
                socket.on("user-count", async (count: number) => {
                    if (count === 2) {
                        // This is the second user, so create the offer
                        shouldCreateOffer = true;
                    }
                });

                // When another user joins, store their socket id
                socket.on("user-joined", async (otherId: string) => {
                    remoteSocketId = otherId;
                    if (shouldCreateOffer) {
                        await createPeerConnection(socket, true, otherId);
                    }
                });

                // When receiving an offer
                socket.on("offer", async ({ offer, from }) => {
                    await createPeerConnection(socket, false, from);
                    await pcRef.current?.setRemoteDescription(new RTCSessionDescription(offer));
                    const answer = await pcRef.current?.createAnswer();
                    await pcRef.current?.setLocalDescription(answer!);
                    socket.emit("answer", { roomId: ROOM_ID, answer, to: from });
                });

                // When receiving an answer
                socket.on("answer", async ({ answer }) => {
                    await pcRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
                });

                // When receiving ICE candidate
                socket.on("ice-candidate", async ({ candidate }) => {
                    try {
                        await pcRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
                    } catch (e) {}
                });

                // When a user leaves
                socket.on("user-left", () => {
                    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
                    pcRef.current?.close();
                    pcRef.current = null;
                });
            } catch (err) {
                setError("Could not access camera/microphone. Please allow permissions.");
            }
        };

        const createPeerConnection = async (socket: Socket, isOfferer: boolean, remoteId: string) => {
            pc = new RTCPeerConnection({
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" }
                ]
            });
            pcRef.current = pc;
            remoteStream = new MediaStream();
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = remoteStream;
            }

            // Add local tracks
            localStreamRef.current?.getTracks().forEach(track => {
                pc.addTrack(track, localStreamRef.current!);
            });

            // When remote track arrives
            pc.ontrack = (event) => {
                event.streams[0].getTracks().forEach(track => {
                    remoteStream.addTrack(track);
                });
            };

            // ICE candidates
            pc.onicecandidate = (event) => {
                if (event.candidate && remoteId) {
                    socket.emit("ice-candidate", { roomId: ROOM_ID, candidate: event.candidate, to: remoteId });
                }
            };

            // If offerer, create offer
            if (isOfferer) {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit("offer", { roomId: ROOM_ID, offer, to: remoteId });
            }
        };

        getMediaAndConnect();

        return () => {
            socketRef.current?.disconnect();
            pcRef.current?.close();
        };
    }, []);

    return (
        <>
            <div className="border border-white rounded-lg w-full h-[50vh] text-center flex items-center justify-center bg-black">
                {error ? (
                    <span className="text-red-500">{error}</span>
                ) : (
                    <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-contain rounded-lg"
                    />
                )}
            </div>
            <div className="border border-white rounded-lg w-full h-[50vh] text-center flex items-center justify-center bg-black">
                <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain rounded-lg"
                />
            </div>
            <div className="text-center mt-2 text-green-400 text-xs">{connected ? "Connected to signaling server" : "Connecting..."}</div>
        </>
    );
};