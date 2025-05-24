/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useEffect, useRef } from "react"
import io from "socket.io-client"
import * as mediasoupClient from "mediasoup-client"

export const Stream = () => {
  const localVideo = useRef<HTMLVideoElement>(null)
  const remoteVideo = useRef<HTMLVideoElement>(null)

  const socket = useRef<any>(null)
  const device = useRef<any>(null)
  const rtpCapabilities = useRef<any>(null)
  const sendTransport = useRef<any>(null)
  const recvTransport = useRef<any>(null)

  // Flags to prevent duplicate transport creation
  const sendTransportCreated = useRef(false);
  const recvTransportCreated = useRef(false);
  const sendTransportTracksProduced = useRef(false); // Flag to prevent re-producing tracks

  const start = async () => {
    console.log('[Client] Starting Stream component initialization');
    socket.current = io("http://localhost:3001");
    
    // Handle socket disconnection
    socket.current.on('disconnect', (reason: string) => {
      console.log(`[Client] Socket disconnected: ${reason}`);
      // If this was an unexpected disconnect, we might want to attempt reconnection
      if (reason === 'io server disconnect' || reason === 'transport close') {
        console.log('[Client] Unexpected disconnect, cleaning up resources');
        cleanup();
      }
    });
    
    // Handle producer-closed event from server
    socket.current.on('producer-closed', ({ producerId }: { producerId: string }) => {
      console.log(`[Client] Server notified that producer ${producerId} closed`);
      // The consumer's 'producerclose' event should handle this automatically
    });

    socket.current.on("router-rtp-capabilities", async (capabilities: any) => {
      console.log('[Client] Received router-rtp-capabilities from server');
      rtpCapabilities.current = capabilities;
      device.current = new mediasoupClient.Device();
      await device.current.load({ routerRtpCapabilities: rtpCapabilities.current });
      
      // Get user media first, then create send transport
      try {
        console.log('[Client] Requesting user media (camera/microphone)');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log('[Client] User media obtained successfully, tracks:', stream.getTracks().map(t => `${t.kind}:${t.id}`).join(', '));
        
        if (localVideo.current) {
          localVideo.current.srcObject = stream;
          // Store stream in ref for cleanup
          localStreamRef.current = stream;
          console.log('[Client] Set local video element source to user media stream');
        }
        
        if (!sendTransportCreated.current) {
          await createSendTransport(stream); // Pass stream here
        } else {
          console.log('[Client] Send transport already created, skipping creation');
        }
      } catch (error) {
        console.error('[Client] Error getting user media:', error);
        // Handle error: display to user, etc.
      }
    })

    socket.current.on("new-producer", async ({ newProducerId }: { newProducerId: string }) => {
      console.log(`[Client] Received new-producer event for producerId: ${newProducerId}`);
      if (newProducerId) {
        await consume(newProducerId);
      } else {
        console.warn('[Client] new-producer event received without newProducerId. Consuming generally.');
        await consume(); // Fallback, though server should always send ID now
      }
    });

    // const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    // if (localVideo.current) localVideo.current.srcObject = stream
    // Moved above to ensure stream is ready before createSendTransport

    // Wait for rtpCapabilities
    socket.current.emit("get-rtp-capabilities")
  }

  // Moved to component level

  const createSendTransport = async (stream: MediaStream) => { // Accept stream as parameter
    if (sendTransportCreated.current) {
      console.log('[Client] Send transport already created, skipping');
      return;
    }
    console.log('[Client] Creating send transport...');
    socket.current.emit("create-transport", { direction: 'send' }, async (params: any) => {
      sendTransport.current = device.current.createSendTransport(params)

      sendTransport.current.on("connect", async ({ dtlsParameters }: any, callback: any, errback: any) => {
        console.log('[Client] sendTransport attempting to connect DTLS');
        socket.current.emit("connect-transport", { transportId: sendTransport.current.id, dtlsParameters }, (response?: { error?: string }) => {
          if (response && response.error) {
            console.error('[Client] sendTransport connect-transport error:', response.error);
            errback(new Error(response.error));
          } else {
            callback();
          }
        });
      });

      sendTransport.current.on("produce", async ({ kind, rtpParameters, appData }: any, callback: any, errback: any) => {
        console.log(`[Client] sendTransport attempting to produce ${kind}`);
        socket.current.emit("produce", { transportId: sendTransport.current.id, kind, rtpParameters, appData }, ({ id: serverProducerId, error }: { id?: string, error?: string }) => {
          if (error) {
            console.error('[Client] sendTransport produce error:', error);
            errback(new Error(error));
            return;
          }
          if (serverProducerId) {
            console.log(`[Client] sendTransport 'produce' event callback: Server returned producerId: ${serverProducerId} for client's ${kind} track.`);
            callback({ id: serverProducerId }); // This ID is what the server knows the producer by
          } else {
            errback(new Error('Server did not return ID for producer'));
          }
        });
      });

      // Use the passed stream directly
      // const stream = localVideo.current!.srcObject as MediaStream 
      const tracks = stream.getTracks();

      if (!sendTransportTracksProduced.current) {
        for (const track of tracks) {
          try {
            console.log(`[Client] Attempting to produce ${track.kind} track: ${track.id}, enabled: ${track.enabled}, muted: ${track.muted}, readyState: ${track.readyState}`);
            const producer = await sendTransport.current.produce({ track });
            console.log(`[Client] Successfully produced ${track.kind} track. Client producerId: ${producer.id}, server producerId (from callback): {appData.id will be here via 'produce' event handler}`);
          } catch (err) {
            console.error(`[Client] Error producing ${track.kind} track:`, err);
            // If one track fails, decide if others should proceed or if we should stop.
          }
        }
        sendTransportTracksProduced.current = true;
      } else {
        console.log('[Client] Tracks already produced for this sendTransport. Skipping.');
      }

      if (!recvTransportCreated.current) {
        await createRecvTransport();
      } else {
        console.log('[Client] Receive transport already created, skipping');
      }
      
      // Mark send transport as created
      sendTransportCreated.current = true;
    })
  }

  const createRecvTransport = async () => {
    if (recvTransportCreated.current) {
      console.log('[Client] Receive transport already created, skipping');
      return;
    }
    console.log('[Client] Creating receive transport...');
    socket.current.emit("create-transport", { direction: 'recv' }, async (params: any) => {
      recvTransport.current = device.current.createRecvTransport(params)

      recvTransport.current.on("connect", ({ dtlsParameters }: any, callback: any, errback: any) => {
        console.log('[Client] recvTransport attempting to connect DTLS');
        socket.current.emit("connect-transport", { transportId: recvTransport.current.id, dtlsParameters }, (response?: { error?: string }) => {
          if (response && response.error) {
            console.error('[Client] recvTransport connect-transport error:', response.error);
            errback(new Error(response.error));
          } else {
            callback();
          }
        });
      });

      // Mark receive transport as created before consuming
      recvTransportCreated.current = true;
      
      // Try to consume any existing producers
      await consume();
    })
  }

  const consume = async (producerIdToConsume?: string) => {
    if (!recvTransport.current || recvTransport.current.closed) {
      console.error("[Client] Cannot consume, recvTransport is not ready or closed.");
      // Optionally, try to re-create recvTransport here or signal an error
      return;
    }
    if (!device.current || !device.current.loaded) {
      console.error("[Client] Cannot consume, device not loaded.");
      return;
    }

    if (!recvTransport.current || !recvTransport.current.id) {
      console.error('[Client] consume: recvTransport or recvTransport.id is undefined. Cannot proceed.');
      return;
    }

    console.log(`[Client] consume: Preparing to send consume request with recvTransport.id: ${recvTransport.current.id}${producerIdToConsume ? `, requesting specific producerId: ${producerIdToConsume}` : ', requesting any available producer'}`);
    
    // Prioritize video producers if no specific producerId is requested
    const consumePayload: { transportId: string; rtpCapabilities: any; producerId?: string; preferredKind?: string } = {
      transportId: recvTransport.current.id,
      rtpCapabilities: device.current.rtpCapabilities,
      preferredKind: 'video' // Tell server to prioritize video producers if available
    };
    
    if (producerIdToConsume) {
      consumePayload.producerId = producerIdToConsume;
    }

    console.log(`[Client] Attempting to consume. Requested producerId: ${producerIdToConsume || 'any'}`);
    socket.current.emit("consume", consumePayload, async (params: any) => {
      if (params.error) {
        console.error(`[Client] Error from server on 'consume' for producer ${producerIdToConsume || 'any'}:`, params.error);
        // TODO: Display this error to the user
        return;
      }
      if (!params.id) {
        console.error(`[Client] Server did not return consumer ID for producer ${producerIdToConsume || 'any'}. Params:`, params);
        return;
      }
      const consumer = await recvTransport.current.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      })

      console.log(`[Client] Consumer created. Kind: ${consumer.kind}, ID: ${consumer.id}, trackId: ${consumer.track.id}, trackKind: ${consumer.track.kind}, trackReadyState: ${consumer.track.readyState}, trackMuted: ${consumer.track.muted}`);
      const stream = new MediaStream();
      stream.addTrack(consumer.track);
      
      // Store remote stream in ref for cleanup
      remoteStreamRef.current = stream;

      if (remoteVideo.current) {
        remoteVideo.current.srcObject = stream;
        console.log(`[Client] Set remote video element source to ${consumer.kind} track`);
      }

      console.log(`[Client] Successfully consumed producer ${params.producerId}, client consumerId: ${consumer.id}. Resuming...`);

      // Since consumer is created paused on server, resume it
      socket.current.emit('resume-consumer', { consumerId: consumer.id }, (resumeResponse: { error?: string }) => {
        if (resumeResponse && resumeResponse.error) {
          console.error(`[Client] Error resuming consumer ${consumer.id}:`, resumeResponse.error);
        } else {
          console.log(`[Client] Consumer ${consumer.id} resumed successfully.`);
        }
      });

      consumer.on('trackended', () => {
        console.warn(`[Client] Consumer track ended for consumerId: ${consumer.id}`);
        if (remoteVideo.current && remoteVideo.current.srcObject === stream) {
          console.log('[Client] Clearing remote video due to track ended');
          remoteVideo.current.srcObject = null;
          remoteStreamRef.current = null;
        }
      });
      
      consumer.on('transportclose', () => {
        console.warn(`[Client] Consumer's transport closed for consumerId: ${consumer.id}`);
        if (remoteVideo.current && remoteVideo.current.srcObject === stream) {
          console.log('[Client] Clearing remote video due to transport close');
          remoteVideo.current.srcObject = null;
          remoteStreamRef.current = null;
        }
      });
      
      consumer.on('producerclose', () => {
        console.warn(`[Client] Consumer's producer closed (producerId: ${consumer.producerId}) for consumerId: ${consumer.id}`);
        if (remoteVideo.current && remoteVideo.current.srcObject === stream) {
          console.log('[Client] Clearing remote video due to producer close');
          remoteVideo.current.srcObject = null;
          remoteStreamRef.current = null;
        }
      });

    });
  }

  // Track local and remote streams for cleanup
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  
  // Cleanup function to close transports and stop tracks
  const cleanup = () => {
    console.log('[Client] Cleaning up Stream component resources');
    
    // Close transports
    if (sendTransport.current && !sendTransport.current.closed) {
      console.log('[Client] Closing send transport');
      sendTransport.current.close();
    }
    
    if (recvTransport.current && !recvTransport.current.closed) {
      console.log('[Client] Closing receive transport');
      recvTransport.current.close();
    }
    
    // Stop local tracks
    if (localStreamRef.current) {
      console.log('[Client] Stopping local media tracks');
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
    }
    
    // Clear video elements
    if (localVideo.current) {
      localVideo.current.srcObject = null;
    }
    
    if (remoteVideo.current) {
      remoteVideo.current.srcObject = null;
    }
    
    // Disconnect socket
    if (socket.current) {
      console.log('[Client] Disconnecting socket');
      socket.current.disconnect();
    }
    
    // Reset refs
    sendTransportCreated.current = false;
    recvTransportCreated.current = false;
    sendTransportTracksProduced.current = false;
  };
  
  useEffect(() => {
    start();
    
    // Set up beforeunload event to clean up when tab is closed
    const handleBeforeUnload = () => {
      cleanup();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Cleanup on component unmount
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanup();
    };
  }, [])

  return (
    <div className="w-full flex flex-col md:flex-row gap-4">
      <video ref={localVideo} autoPlay muted className="border border-gray-700 rounded-lg w-full md:w-1/2 aspect-video object-cover" />
      <video ref={remoteVideo} autoPlay className="border border-gray-700 rounded-lg w-full md:w-1/2 aspect-video object-cover" />
    </div>
  )
}
