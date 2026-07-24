import { intelGetAddress, x402PayInvoice } from './packages/runtime/mcp/server.mjs'

async function run() {
  console.log("1. Requesting intel for address (should get invoice)...")
  const result1 = await intelGetAddress({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", service: "basic" })
  console.log("Result 1:", JSON.stringify(result1, null, 2))
  
  if (result1.x402 && result1.x402.paymentId) {
    const paymentId = result1.x402.paymentId
    console.log(`\n2. Paying invoice ${paymentId} (preview)...`)
    const quote = await x402PayInvoice({ paymentId })
    console.log("Quote:", JSON.stringify(quote, null, 2))
    
    console.log(`\n3. Confirming payment...`)
    const payResult = await x402PayInvoice({ paymentId, confirmed: true, previewId: quote.previewId, confirmationText: "yes" })
    console.log("Payment Result:", JSON.stringify(payResult, null, 2))
    
    console.log("\n4. Requesting intel again with unlocked service...")
    // In practice, we might need to wait a few seconds or pass the paymentId if it accepts it.
    // Let's pass the paymentId in the arguments if intelGetAddress supports it, else we see.
    const result2 = await intelGetAddress({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", service: "basic", paymentId })
    console.log("Final Intel Result:", JSON.stringify(result2, null, 2))
  }
}
run().catch(console.error)
