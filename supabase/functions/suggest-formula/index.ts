import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { signalStats } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a signal processing expert specializing in LoRa, FHSS, and radio signal modeling. Given statistical properties of a radio signal, suggest the best mathematical formula type and explain why. If unified model results are provided, analyze the quality and suggest improvements.

Available formula types:
1. "chirp" — y(t) = A·exp(-αt)·cos(2π(f₀t + βt²/2) + φ) + C — best for LoRa CSS chirp signals with linear frequency modulation
2. "damped_sine" — y(t) = A·exp(-αt)·sin(2πf₀t + φ) + C — best for decaying oscillations, impulse responses
3. "gaussian" — y(t) = A·exp(-(t-μ)²/(2σ²))·cos(2πf₀t + φ) + C — best for localized wave packets, burst signals
4. "harmonics" — y(t) = A₁sin(2πf₁t) + A₂sin(2πf₂t) + A₃sin(2πf₃t) + C — best for periodic multi-frequency signals
5. "polynomial" — y(t) = a₀ + a₁t + a₂t² + a₃t³ + a₄t⁴ + a₅t⁵ — best for smooth envelope approximation
6. "lorentzian" — y(t) = A·γ²/((t-t₀)²+γ²)·cos(2πf₀t+φ) + C — best for resonance peaks, spectral lines
7. "fm" — y(t) = A·cos(2π·f₀t + β·sin(2π·fm·t) + φ) + C — best for FM/GFSK signals
8. "exp_rise" — y(t) = A·(1-e^(-t/τ))·sin(2πf₀t+φ) + C — best for transient/startup responses

For unified FHSS+Channel models, analyze: signal parameters Θ (text), FHSS parameters Φ (hopping), and channel parameters Ψ (propagation).

You MUST respond using the suggest_formula tool.`;

    const userPrompt = `Analyze the following signal statistics and suggest the best formula type:

Signal parameters:
- Spreading Factor (SF): ${signalStats.sf}
- Bandwidth (BW): ${signalStats.bw} Hz
- Duration: ${signalStats.duration} seconds
- Number of symbols: ${signalStats.nSymbols}
- Sample count: ${signalStats.sampleCount}

Signal characteristics:
- Mean amplitude: ${signalStats.meanAmp?.toFixed(6) ?? 'N/A'}
- Max amplitude: ${signalStats.maxAmp?.toFixed(6) ?? 'N/A'}
- Std deviation: ${signalStats.stdAmp?.toFixed(6) ?? 'N/A'}
- Zero crossings per period: ${signalStats.zeroCrossings ?? 'N/A'}
- Amplitude trend: ${signalStats.trend ?? 'unknown'}

Based on these characteristics, which formula type would best approximate this signal and why?`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_formula",
            description: "Suggest the best formula type for the signal",
            parameters: {
              type: "object",
              properties: {
                formulaType: {
                  type: "string",
                  enum: ["chirp", "damped_sine", "gaussian", "harmonics", "polynomial"],
                },
                confidence: {
                  type: "number",
                  description: "Confidence 0-1",
                },
                reasoning: {
                  type: "string",
                  description: "Brief explanation in Russian why this formula is the best fit",
                },
                alternativeType: {
                  type: "string",
                  enum: ["chirp", "damped_sine", "gaussian", "harmonics", "polynomial"],
                  description: "Second best formula type",
                },
              },
              required: ["formulaType", "confidence", "reasoning"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_formula" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in response");

    const suggestion = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(suggestion), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-formula error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
