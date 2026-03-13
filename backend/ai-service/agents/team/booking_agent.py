from agno.agent import Agent
from agno.models.openai import OpenAIChat
from prompts.booking_prompt import build_booking_prompt
from tools.booking_tools import (
    check_availability,
    create_appointment,
    cancel_appointment,
)
from tools.client_tools import get_client, get_pets, get_upcoming_appointments


def build_booking_agent(context: dict) -> Agent:
    return Agent(
        name="Booking Agent",
        model=OpenAIChat(id="gpt-4o-mini"),
        instructions=build_booking_prompt(context),
        tools=[
            check_availability,
            create_appointment,
            cancel_appointment,
            get_client,
            get_pets,
            get_upcoming_appointments,
        ],
        show_tool_calls=False,
        markdown=False,
    )
