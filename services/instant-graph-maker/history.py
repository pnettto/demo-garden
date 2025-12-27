import json
import datetime
import streamlit as st

from streamlit_js_eval import streamlit_js_eval

from constants import (
    ENTRY_HISTORY_INDEX,
    IMPROVEMENT_ENTRY_INDEX,
    IMPROVEMENT_QUERY,
    LOCAL_STORAGE_HISTORY,
    ORIGINAL_QUERY,
)

from ui_components import (
    render_chart
)

def render_version_navigation(history, current_index) -> None:
    col_prev, col_next = st.columns([1, 1])
    with col_prev:
        if st.button("Prev", disabled=current_index == 0, width='stretch', key="prev_btn"):
            st.session_state[ENTRY_HISTORY_INDEX] = current_index - 1
            st.session_state[IMPROVEMENT_QUERY] = ""
            st.session_state[IMPROVEMENT_ENTRY_INDEX] = None

            st.rerun()
    with col_next:
        if st.button("Next", disabled=current_index >= len(history) - 1, width='stretch', key="next_btn"):
            st.session_state[ENTRY_HISTORY_INDEX] = current_index + 1
            st.session_state[IMPROVEMENT_QUERY] = ""
            st.session_state[IMPROVEMENT_ENTRY_INDEX] = None
            st.rerun()

    current_entry = history[current_index]
    st.markdown(f"{current_index + 1}/{len(history)} - {current_entry['query']}")

def render_chart_history(history, dfs) -> None:
    if (len(history) == 0):
        return
    
    st.write('---')
    st.write('### Improvement History')
    with st.expander("Show", expanded=False):
        for i, entry in enumerate(history):
            if i > 0:
                st.markdown("---")
            st.markdown(f"{'Improvement' if i > 0 else 'Original query'}: {entry['query']}")
            
            render_chart(entry, dfs)
            
            with st.expander("Show generated code", expanded=False):
                st.code(entry["code"])
            
            if st.button(f"Recover", key=f"recover_btn_{i}"):
                st.session_state[ENTRY_HISTORY_INDEX] = i
                st.rerun()

def sync_local_storage_history_to_session():
    result = streamlit_js_eval(
        js_expressions="localStorage.getItem('chart_history')",
        key="get_chart_history"
    )
    if result is None:
        st.session_state[LOCAL_STORAGE_HISTORY] = None
    else:
        st.session_state[LOCAL_STORAGE_HISTORY] = result

def render_local_storage_history_recovering_tool_load(chart_gen, separator=False):
    # Load histories from localStorage
    existing_history = st.session_state[LOCAL_STORAGE_HISTORY]
    if existing_history:
        try:
            history = json.loads(existing_history)
        except Exception as e:
            st.error(f"Couldn’t read the chart history: {e}")
            history = []
    else:
        history = []

    if history:
        st.markdown('### Open a previous exploration')
        selected_index = st.selectbox(
            label="Select",
            options=list(range(len(history))),
            format_func=lambda idx: (
                f"{datetime.datetime.fromisoformat(history[idx]['date']).strftime('%Y-%m-%d@%H:%M')}: "
                f"{history[idx]['history'][0]['query']}"
            ),
        )
        if st.button("Load", key="load_history_btn"):
            selected_history_item = history[selected_index]
            chart_gen.history = selected_history_item['history']
            st.session_state[ORIGINAL_QUERY] = selected_history_item['history'][0]['query']
            st.rerun()

        if separator:
            st.markdown('---')

def render_copy_history(new_history_entry):
    html_code = f"""
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Code+Pro:ital,wght@0,200..900;1,200..900&display=swap">
        <style>
            #copy-btn {{
                font-family: 'Source Code Pro', monospace;
                align-items: center;
                appearance: button;
                background-color: rgb(33, 46, 69);
                border: 1px solid rgb(49, 65, 88);
                border-radius: 8px;
                box-sizing: border-box;
                color: rgb(226, 232, 240);
                cursor: pointer;
                display: inline-flex;
                font-size: 16px;
                font-weight: 400;
                height: 40px;
                justify-content: center;
                line-height: 25.6px;
                margin-left: -8px;
                min-height: 40px;
                padding: 4px 12px;
                text-align: center;
                user-select: none;
            }}
        </style>
        <button id="copy-btn">Copy exploration</button>

        <script>
        const btn = document.getElementById('copy-btn');
        btn.addEventListener('click', async () => {{
            try {{
                await navigator.clipboard.writeText(JSON.stringify({json.dumps(new_history_entry)}));
                btn.innerText = "Copied";
                setTimeout(() => {{ btn.innerText = "Copy exploration"; }}, 3000);
            }} catch (err) {{
                console.error("Clipboard copy failed:", err);
                btn.innerText = "Failed :(";
            }}
        }});
        </script>
    """

    st.components.v1.html(html_code, height=50)

def render_local_storage_recovering_tool_save(chart_gen):
    new_history_entry = {
        "date": datetime.datetime.now().isoformat(),
        "history": chart_gen.history,
    }
    
    if st.button("Save current exploration", key="save_history_btn"):
        try:
            existing_history = st.session_state[LOCAL_STORAGE_HISTORY]
            history = json.loads(existing_history)
        except:
            history = []
    
        history.append(new_history_entry)
        history.sort(key=lambda x: x["date"], reverse=True)
        safe_history_json = json.dumps(history)
        
        st.session_state[LOCAL_STORAGE_HISTORY] = safe_history_json
        
        # Use HTML component to save to localStorage (without rerun)
        save_html = f"""
        <script>
        (function() {{
            const data = {safe_history_json};
            localStorage.setItem('chart_history', JSON.stringify(data));
            console.log('Saved to localStorage');
        }})();
        </script>
        """
        st.components.v1.html(save_html, height=0)
        st.success("Saved")
    
    render_copy_history(new_history_entry)