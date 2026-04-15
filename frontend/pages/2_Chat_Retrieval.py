from __future__ import annotations

import time
import requests
import streamlit as st

st.set_page_config(page_title="Chat Retrieval | Offline RAG", page_icon="RAG", layout="wide")

if "api_base_url" not in st.session_state:
    st.session_state.api_base_url = "http://127.0.0.1:8000"
if "chat_messages" not in st.session_state:
    st.session_state.chat_messages = []

st.sidebar.header("Connection")
st.session_state.api_base_url = st.sidebar.text_input(
    "Backend URL",
    value=st.session_state.api_base_url,
    key="api_base_url_chat",
)
top_k = st.sidebar.slider("Top-K Retrieval", min_value=1, max_value=10, value=5)
temperature = st.sidebar.slider("Temperature", min_value=0.0, max_value=1.5, value=0.7, step=0.05)
top_p = st.sidebar.slider("Top-p", min_value=0.1, max_value=1.0, value=0.9, step=0.05)
generation_top_k = st.sidebar.slider("Generation Top-k", min_value=1, max_value=200, value=40, step=1)
max_tokens = st.sidebar.slider("Max Tokens", min_value=64, max_value=2048, value=700, step=32)
frequency_penalty = st.sidebar.slider("Frequency Penalty", min_value=0.0, max_value=2.0, value=0.2, step=0.05)
presence_penalty = st.sidebar.slider("Presence Penalty", min_value=0.0, max_value=2.0, value=0.15, step=0.05)
query_type = st.sidebar.selectbox(
    "Query Type",
    options=["auto", "factual", "coding", "conversational", "analytical", "creative"],
    index=0,
)
output_mode = st.sidebar.selectbox(
    "Output Mode",
    options=["auto", "plain_text", "json", "code", "steps", "table"],
    index=0,
)
stream_chunk_chars = st.sidebar.slider("Stream Chunk Size", min_value=60, max_value=400, value=120, step=10)

if st.sidebar.button("Clear Chat", use_container_width=True):
    st.session_state.chat_messages = []

st.title("Chat Retrieval")
st.caption("Live relay mode: response is streamed from backend in incremental chunks.")

for msg in st.session_state.chat_messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])
        if msg["role"] == "assistant" and msg.get("sources"):
            with st.expander("Sources"):
                for item in msg["sources"]:
                    page = item.get("page")
                    page_text = f" | page={page}" if page else ""
                    st.write(
                        f"{item.get('source_file')} | score={item.get('score', 0):.4f} "
                        f"| chunk={item.get('chunk_id')}{page_text}"
                    )
                    st.write(item.get("text", ""))

user_input = st.chat_input("Ask a question about your documents")

if user_input:
    st.session_state.chat_messages.append({"role": "user", "content": user_input})

    with st.chat_message("user"):
        st.markdown(user_input)

    with st.chat_message("assistant"):
        answer_placeholder = st.empty()
        current_text = ""
        sources = []

        try:
            request_payload = {
                "query": user_input,
                "top_k": top_k,
                "temperature": temperature,
                "top_p": top_p,
                "generation_top_k": generation_top_k,
                "max_tokens": max_tokens,
                "frequency_penalty": frequency_penalty,
                "presence_penalty": presence_penalty,
                "query_type": query_type,
                "output_mode": output_mode,
                "stream_chunk_chars": stream_chunk_chars,
            }
            start_resp = requests.post(
                f"{st.session_state.api_base_url}/query/start",
                json=request_payload,
                timeout=60,
            )
            if not start_resp.ok:
                raise RuntimeError(f"Start failed: {start_resp.text}")

            job_id = start_resp.json().get("job_id")
            if not job_id:
                raise RuntimeError("Missing job_id from /query/start")

            done = False
            while not done:
                next_resp = requests.get(
                    f"{st.session_state.api_base_url}/query/next/{job_id}",
                    params={"max_chunks": 5},
                    timeout=120,
                )
                if not next_resp.ok:
                    raise RuntimeError(f"Next failed: {next_resp.text}")

                payload = next_resp.json()
                delta = payload.get("delta", "")
                if delta:
                    current_text += delta
                    answer_placeholder.markdown(current_text + "▌")

                if payload.get("error"):
                    raise RuntimeError(payload["error"])

                done = bool(payload.get("done"))
                if done:
                    sources = payload.get("sources", [])
                    break

                time.sleep(0.08)

            answer_placeholder.markdown(current_text if current_text.strip() else "No answer returned.")

            if sources:
                with st.expander("Sources"):
                    for item in sources:
                        page = item.get("page")
                        page_text = f" | page={page}" if page else ""
                        st.write(
                            f"{item.get('source_file')} | score={item.get('score', 0):.4f} "
                            f"| chunk={item.get('chunk_id')}{page_text}"
                        )
                        st.write(item.get("text", ""))

            st.session_state.chat_messages.append(
                {
                    "role": "assistant",
                    "content": current_text if current_text.strip() else "No answer returned.",
                    "sources": sources,
                }
            )
        except Exception as exc:
            err = f"Query error: {exc}"
            answer_placeholder.error(err)
            st.session_state.chat_messages.append({"role": "assistant", "content": err, "sources": []})
